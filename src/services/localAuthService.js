const crypto = require('crypto');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const pool = require('../database/config');
const logger = require('../utils/logger');

const scrypt = promisify(crypto.scrypt);

/**
 * Prihlásenie menom a heslom, popri Azure AD.
 *
 * Do výrobného plánu treba pozvať dodávateľov zvonku a tí firemné M365 nemajú.
 * Je to teda druhá cesta do portálu - nie do jedného modulu - a všetko tu je
 * napísané s tým vedomím:
 *
 *   * Heslo sa nikdy neukladá, ukladá sa scrypt odtlačok so soľou. Parametre sú
 *     uložené s ním, aby sa dali časom zosilniť bez toho, aby staré heslá
 *     prestali fungovať.
 *   * Token podpisujeme vlastným tajomstvom (HS256). Bez `LOCAL_AUTH_SECRET`
 *     sa lokálne prihlásenie NEZAPNE - nikdy nespadne na niečo slabšie.
 *   * Vlastný `iss` a `typ`, aby sa náš token nedal zameniť za token od Azure.
 *   * Zámok po piatich pokusoch. M365 bráni hádaniu hesla za nás; tu si to
 *     musíme spraviť sami, inak by sme na verejnú adresu vyvesili dvere bez
 *     zámku.
 *   * Účet zo zoznamu nemiznú, len sa vypnú - história žiadostí a zmien v pláne
 *     musí zostať čitateľná aj potom, ako dodávateľ prestane spolupracovať.
 */

const ISSUER = 'etilog-portal';
const TOKEN_TTL = process.env.LOCAL_AUTH_TTL || '12h';

// Päť pokusov a štvrťhodina. Dosť na to, aby človek s prepnutou klávesnicou
// nezostal vonku do rána, a málo na to, aby sa heslo dalo hádať.
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

// N=16384 je odporúčaná spodná hranica pre interaktívne prihlásenie: na
// serveri to trvá desiatky milisekúnd, útočníkovi to zdraží každý pokus.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const secret = () => process.env.LOCAL_AUTH_SECRET || null;

/** Je lokálne prihlásenie vôbec zapnuté? */
function enabled() {
  const value = secret();
  // Krátke tajomstvo je horšie než žiadne - vyzerá nastavene a nechráni nič.
  return Boolean(value && value.length >= 32);
}

// ------------------------------------------------------------------- heslá

/**
 * Odtlačok hesla vo formáte `scrypt$N$r$p$soľ$hash`.
 *
 * Parametre sú v reťazci schválne: keď sa o dva roky N zdvihne, staré heslá sa
 * budú overovať pôvodnými parametrami a prepíšu sa až pri najbližšom
 * prihlásení. Bez toho by sa zosilnenie rovnalo resetu hesiel všetkým.
 */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/**
 * Overenie hesla proti odtlačku.
 *
 * Porovnáva sa `timingSafeEqual`, nie `===`: bežné porovnanie skončí na prvom
 * odlišnom bajte a z času odpovede sa dá odtlačok postupne uhádnuť.
 */
async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, N, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');

  let derived;
  try {
    derived = await scrypt(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p)
    });
  } catch (error) {
    logger.warn('Password hash could not be evaluated', { error: error.message });
    return false;
  }

  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

// ------------------------------------------------------------------ tokeny

/**
 * Náš vlastný token.
 *
 * `iss` a `typ` sú tu preto, aby sa nedal predložiť tam, kde sa čaká token od
 * Azure, a naopak. Overovanie ich vyžaduje, nie len číta.
 */
function issueToken(user) {
  if (!enabled()) throw new Error('Local sign-in is not configured');

  return jwt.sign(
    {
      sub: user.user_id,
      email: user.email,
      name: user.display_name || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
      typ: 'local'
    },
    secret(),
    { algorithm: 'HS256', issuer: ISSUER, expiresIn: TOKEN_TTL }
  );
}

/**
 * Overenie nášho tokenu.
 *
 * `algorithms: ['HS256']` je tu zámerne a je to to najdôležitejšie v celom
 * súbore: bez neho by sa dal podstrčiť token s iným algoritmom a nechať si ho
 * overiť kľúčom, ktorý na to nepatrí.
 *
 * Účet sa navyše kontroluje pri každom requeste - vypnutie dodávateľa musí
 * platiť okamžite, nie až keď mu vyprší token.
 */
async function verifyLocalToken(token) {
  if (!enabled()) return null;

  let payload;
  try {
    payload = jwt.verify(token, secret(), { algorithms: ['HS256'], issuer: ISSUER });
  } catch (error) {
    return null;
  }
  if (payload.typ !== 'local') return null;

  const { rows } = await pool.query(
    `SELECT user_id, email, display_name, first_name, last_name, role, is_active
       FROM users WHERE user_id = $1 AND auth_provider = 'local'`,
    [payload.sub]
  );
  const user = rows[0];
  if (!user || !user.is_active) return null;

  return {
    id: user.user_id,
    email: user.email,
    name: user.display_name || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
    roles: [],
    authProvider: 'local'
  };
}

// --------------------------------------------------------------- prihlásenie

/**
 * Prihlásenie e-mailom a heslom.
 *
 * Odpoveď na neexistujúci e-mail a na zlé heslo je zámerne rovnaká: rozdiel by
 * povedal, ktoré adresy v portáli existujú.
 */
async function signIn(email, password) {
  if (!enabled()) return { error: 'not_configured' };
  if (!email || !password) return { error: 'bad_credentials' };

  const { rows } = await pool.query(
    `SELECT id, user_id, email, display_name, first_name, last_name, role,
            password_hash, is_active, must_change_password, failed_logins, locked_until
       FROM users
      WHERE lower(email) = lower($1) AND auth_provider = 'local'`,
    [String(email).trim()]
  );
  const user = rows[0];

  if (!user || !user.password_hash) {
    // Aj tak sa počíta jedno scrypt overenie, nech neexistujúci účet neodpovie
    // viditeľne rýchlejšie než existujúci.
    await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    return { error: 'bad_credentials' };
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return { error: 'locked', until: user.locked_until };
  }
  if (!user.is_active) return { error: 'disabled' };

  const ok = await verifyPassword(password, user.password_hash);

  if (!ok) {
    const failed = (user.failed_logins || 0) + 1;
    const lock = failed >= MAX_FAILED;
    await pool.query(
      `UPDATE users
          SET failed_logins = $2,
              locked_until = CASE WHEN $3 THEN CURRENT_TIMESTAMP + ($4 || ' minutes')::interval ELSE locked_until END
        WHERE id = $1`,
      [user.id, lock ? 0 : failed, lock, String(LOCK_MINUTES)]
    );
    logger.warn('Local sign-in failed', { email: user.email, attempt: failed, locked: lock });
    return lock ? { error: 'locked' } : { error: 'bad_credentials' };
  }

  await pool.query(
    `UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [user.id]
  );

  logger.info('Local sign-in', { email: user.email });
  return {
    token: issueToken(user),
    mustChangePassword: user.must_change_password,
    user: {
      id: user.user_id,
      email: user.email,
      name: user.display_name || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
      role: user.role
    }
  };
}

/**
 * Zmena vlastného hesla.
 *
 * Staré heslo sa vyžaduje aj vtedy, keď má človek `must_change_password` -
 * inak by ukradnutý token stačil na to, aby útočník účet prebral.
 */
async function changePassword(userId, currentPassword, newPassword) {
  const problem = passwordProblem(newPassword);
  if (problem) return { error: problem };

  const { rows } = await pool.query(
    "SELECT id, password_hash FROM users WHERE user_id = $1 AND auth_provider = 'local'",
    [userId]
  );
  const user = rows[0];
  if (!user) return { error: 'not_found' };

  if (!await verifyPassword(currentPassword, user.password_hash)) {
    return { error: 'bad_credentials' };
  }

  await pool.query(
    `UPDATE users SET password_hash = $2, must_change_password = FALSE,
            failed_logins = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [user.id, await hashPassword(newPassword)]
  );
  return { changed: true };
}

/**
 * Čo je s heslom zle, ak niečo.
 *
 * Dĺžka, nie zoznam povinných druhov znakov: „aspoň jedno veľké písmeno a jedna
 * číslica" vyrába Heslo1! a nechráni pred ničím. Dlhšie heslo je lepšie heslo.
 */
function passwordProblem(password) {
  if (!password || password.length < 10) return 'too_short';
  if (password.length > 200) return 'too_long';
  return null;
}

/** Návrh hesla pre nový účet, keď ho admin nechce vymýšľať. */
function suggestPassword() {
  // Bez znakov, ktoré sa pri odpisovaní z papiera pletú: 0/O, 1/l/I.
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

/** Identifikátor lokálneho účtu. Prefix, aby sa nedal zameniť s Azure oid. */
const newUserId = () => `local:${uuidv4()}`;

module.exports = {
  enabled,
  hashPassword,
  verifyPassword,
  issueToken,
  verifyLocalToken,
  signIn,
  changePassword,
  passwordProblem,
  suggestPassword,
  newUserId,
  ISSUER,
  MAX_FAILED,
  LOCK_MINUTES
};
