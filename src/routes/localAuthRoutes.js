const express = require('express');
const router = express.Router();

const localAuth = require('../services/localAuthService');
const User = require('../database/models/User');
const pool = require('../database/config');
const { verifyToken } = require('../middleware/auth');
const { attachDbRole } = require('../middleware/portalAuth');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * Prihlásenie e-mailom a heslom, a správa takých účtov.
 *
 * Dodávatelia, ktorých pozývame do výrobného plánu, firemné M365 nemajú. Toto
 * sú jediné cesty, ktorými sa dá lokálny účet vytvoriť alebo použiť - a jediné
 * miesto v portáli, kam sa dá zavolať bez tokenu, je `POST /login`.
 */

// Zakladať a resetovať účty smie len admin. Nie je to práca, ktorú by mal robiť
// niekto s právom na jeden modul - je to rozdávanie prístupu do portálu.
function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin only' });
  }
  next();
}

const adminOnly = [verifyToken, attachDbRole, requireAdmin];

/** Meno, ako sa má ukazovať. Priezvisko a meno zvlášť, zlepené až tu. */
const fullName = (first, last, fallback) =>
  [String(first || '').trim(), String(last || '').trim()].filter(Boolean).join(' ') || fallback;

// =========================================================
// Prihlásenie
// =========================================================

// GET /api/auth/methods - čo prihlasovacia stránka vôbec smie ponúknuť
//
// Verejné, bez tokenu: stránka to potrebuje ešte predtým, než sa niekto
// prihlási. Neprezrádza nič - len či je heslom prihlásenie zapnuté.
router.get('/methods', (req, res) => {
  res.json({ data: { microsoft: true, password: localAuth.enabled() } });
});

// POST /api/auth/login  { email, password }
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const result = await localAuth.signIn(email, password);

  if (result.error) {
    // Neexistujúci e-mail a zlé heslo dostanú tú istú odpoveď. Rozdiel by
    // povedal, ktoré adresy v portáli existujú.
    const status = { not_configured: 503, locked: 423, disabled: 403 }[result.error] || 401;
    return res.status(status).json({ error: result.error });
  }

  res.json({ data: result });
}));

// POST /api/auth/change-password  { currentPassword, newPassword }
router.post('/change-password', verifyToken, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const result = await localAuth.changePassword(req.user.id, currentPassword, newPassword);
  if (result.error) return res.status(result.error === 'bad_credentials' ? 401 : 400).json({ error: result.error });
  res.json({ data: { changed: true } });
}));

// =========================================================
// Správa lokálnych účtov (admin)
// =========================================================

// GET /api/auth/local-users
router.get('/local-users', adminOnly, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, user_id, email, display_name, first_name, last_name, role,
            is_active, must_change_password, last_login_at, locked_until, created_at,
            is_kiosk, pin_hash IS NOT NULL AS has_pin, pin_set_at
       FROM users WHERE auth_provider = 'local'
      ORDER BY lower(coalesce(last_name, display_name, email))`
  );
  res.json({ data: rows });
}));

// POST /api/auth/local-users  { email, firstName, lastName, role, password? }
router.post('/local-users', adminOnly, asyncHandler(async (req, res) => {
  if (!localAuth.enabled()) {
    return res.status(503).json({ error: 'not_configured' });
  }

  const { email, firstName, lastName, role } = req.body || {};
  const address = String(email || '').trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return res.status(400).json({ error: 'bad_email' });
  }
  if (!String(lastName || '').trim()) {
    return res.status(400).json({ error: 'last_name_required' });
  }

  // Heslo si admin buď zadá, alebo ho necháme vygenerovať. Vygenerované je
  // takmer vždy lepšie - vymyslené býva to isté pre všetkých dodávateľov.
  const password = req.body.password || localAuth.suggestPassword();
  const problem = localAuth.passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  const existing = await pool.query(
    "SELECT 1 FROM users WHERE lower(email) = $1 AND auth_provider = 'local'", [address]
  );
  if (existing.rows.length) return res.status(409).json({ error: 'email_exists' });

  const { rows } = await pool.query(
    `INSERT INTO users (user_id, email, display_name, first_name, last_name, role,
                        auth_provider, password_hash, must_change_password, is_kiosk)
     VALUES ($1, $2, $3, $4, $5, $6, 'local', $7, $8, $9)
     RETURNING id, user_id, email, display_name, first_name, last_name, role, is_active, is_kiosk`,
    [
      localAuth.newUserId(), address,
      fullName(firstName, lastName, address),
      String(firstName || '').trim() || null,
      String(lastName || '').trim(),
      role || 'user',
      await localAuth.hashPassword(password),
      // Tablet na stene si heslo nemení - k jeho obrazovke nikto samostatný
      // účet nemá a vynútená zmena by ho len zamkla pri prvom prihlásení.
      !req.body.isKiosk,
      Boolean(req.body.isKiosk)
    ]
  );

  logger.info('Local user created', { email: address, by: req.user.email });

  // Heslo sa vracia jediný raz, tu. Nikde sa neukladá v čitateľnej podobe, tak
  // ho admin musí odovzdať teraz - potom sa dá už len nastaviť nové.
  res.status(201).json({ data: { ...rows[0], password } });
}));

// PATCH /api/auth/local-users/:id  { firstName?, lastName?, role?, isActive? }
router.patch('/local-users/:id', adminOnly, asyncHandler(async (req, res) => {
  const { firstName, lastName, role, isActive, isKiosk } = req.body || {};

  const { rows } = await pool.query(
    `UPDATE users
        SET first_name = COALESCE($2, first_name),
            last_name  = COALESCE($3, last_name),
            role       = COALESCE($4, role),
            is_active  = COALESCE($5, is_active),
            is_kiosk   = COALESCE($6, is_kiosk),
            display_name = COALESCE($2, first_name) || ' ' || COALESCE($3, last_name),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND auth_provider = 'local'
      RETURNING id, user_id, email, display_name, first_name, last_name, role, is_active, is_kiosk`,
    [
      req.params.id,
      firstName !== undefined ? String(firstName).trim() || null : null,
      lastName !== undefined ? String(lastName).trim() || null : null,
      role !== undefined ? role : null,
      isActive !== undefined ? Boolean(isActive) : null,
      isKiosk !== undefined ? Boolean(isKiosk) : null
    ]
  );

  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  logger.info('Local user updated', { email: rows[0].email, by: req.user.email });
  res.json({ data: rows[0] });
}));

// POST /api/auth/local-users/:id/password - nastaviť nové heslo
//
// Admin heslo nastaví, používateľ si ho pri najbližšom prihlásení musí zmeniť.
// Admin tak nikdy nepozná heslo, ktorým sa niekto reálne prihlasuje.
router.post('/local-users/:id/password', adminOnly, asyncHandler(async (req, res) => {
  const password = req.body?.password || localAuth.suggestPassword();
  const problem = localAuth.passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  const { rows } = await pool.query(
    `UPDATE users
        SET password_hash = $2, must_change_password = TRUE,
            failed_logins = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND auth_provider = 'local'
      RETURNING email`,
    [req.params.id, await localAuth.hashPassword(password)]
  );

  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  logger.info('Local password reset', { email: rows[0].email, by: req.user.email });
  res.json({ data: { password } });
}));

// POST /api/auth/local-users/:id/pin  { pin }  - nastaviť PIN k tabletu
//
// PIN zadáva administrátor a odovzdá ho majstrom. Späť sa prečítať nedá - v
// databáze je len scrypt odtlačok, rovnako ako pri hesle. Zmeniť sa dá kedykoľvek
// na nový; to je jediná cesta, ak sa zabudne.
router.post('/local-users/:id/pin', adminOnly, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT user_id, email FROM users WHERE id = $1 AND auth_provider = 'local'",
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });

  const result = await localAuth.setPin(rows[0].user_id, req.body?.pin);
  if (result.error) return res.status(400).json({ error: result.error });

  logger.info('Tablet PIN set', { email: rows[0].email, by: req.user.email });
  res.json({ data: { ok: true } });
}));

// DELETE /api/auth/local-users/:id/pin - zrušiť PIN
//
// Účet tabletu bez PINu sa na obrazovku vyskladnenia nedostane. To je zámer:
// zrušený PIN znamená zamknutý tablet, nie otvorený.
router.delete('/local-users/:id/pin', adminOnly, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT user_id, email FROM users WHERE id = $1 AND auth_provider = 'local'",
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });

  await localAuth.clearPin(rows[0].user_id);
  logger.info('Tablet PIN cleared', { email: rows[0].email, by: req.user.email });
  res.json({ data: { ok: true } });
}));

module.exports = router;
