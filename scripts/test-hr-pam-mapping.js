#!/usr/bin/env node
/**
 * Párovanie zamestnanca na PAM: osobné číslo a príznak externého.
 *
 *   node scripts/test-hr-pam-mapping.js
 *
 * Toto je prvá polovica napojenia na SOFTIP PAM. Sama o sebe ešte nikam
 * nevolá - len hovorí, koho tam vôbec hľadať a pod akým číslom.
 *
 * Dve veci tu stoja za to, aby ich strážil test:
 *
 * 1. Jedno osobné číslo smie patriť jednému človeku. Keby sa dalo zadať
 *    dvakrát, nočná synchronizácia by dvom ľuďom písala tie isté kvóty a na
 *    obrazovke by to vyzeralo úplne normálne - len by to bolo zle.
 *
 * 2. Externému sa osobné číslo zahadzuje. Zahraniční spolupracovníci
 *    fakturujú a v PAM nie sú; keby im tam číslo zostalo ležať, pri ďalšej
 *    synchronizácii by k nim prišli kvóty cudzieho človeka, ktorý to číslo
 *    medzitým dostal.
 *
 * Skript si vyrobí vlastných používateľov aj roly a na konci ich po sebe
 * zmaže. Proti inému než lokálnemu serveru sa odmietne spustiť.
 */

require('dotenv').config();

const dbHost = process.env.DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '/tmp'].includes(dbHost) && process.env.ALLOW_REMOTE_DB !== 'yes') {
  console.error(`\nOdmietam bežať proti ${dbHost}. Toto je test, nie nástroj na produkčné dáta.\n`);
  process.exit(1);
}

process.env.LOCAL_AUTH_SECRET ||= require('crypto').randomBytes(48).toString('base64');
process.env.MICROSOFT_APP_ID ||= '00000000-0000-0000-0000-000000000000';
process.env.MICROSOFT_APP_PASSWORD ||= 'test';
process.env.TENANT_ID ||= '00000000-0000-0000-0000-000000000000';
process.env.CLIENT_ID ||= process.env.MICROSOFT_APP_ID;
process.env.LOG_LEVEL = 'error';
process.env.ACCESS_CONTROL_MODE ||= 'enforce';

const http = require('http');
const pool = require('../src/database/config');
const auth = require('../src/services/localAuthService');
const app = require('../src/index');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const OFF = '\x1b[0m';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? `${GREEN}OK${OFF}  ` : `${RED}FAIL${OFF}`} ${label}` +
              (ok ? '' : `  čakalo ${JSON.stringify(expected)}, prišlo ${JSON.stringify(actual)}`));
  if (!ok) failures += 1;
};

let port;
function call(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const ROLES = ['zz-pam-hr', 'zz-pam-nikto'];
const users = ['local:zz-pam-hr', 'local:zz-pam-nikto', 'zz-pam-anna', 'zz-pam-boris'];

async function cleanup() {
  await pool.query('DELETE FROM employee_quotas WHERE user_id = ANY($1)', [users]);
  await pool.query('DELETE FROM users WHERE user_id = ANY($1)', [users]);
  await pool.query('DELETE FROM roles WHERE name = ANY($1)', [ROLES]).catch(() => {});
}

async function account(roleName, permissions, email) {
  const Role = require('../src/database/models/Role');
  await pool.query('INSERT INTO roles (name, label, is_system) VALUES ($1,$1,FALSE) ON CONFLICT (name) DO NOTHING',
                   [roleName]);
  await Role.setPermissions(roleName, permissions);
  Role.invalidateCache();

  await pool.query(
    `INSERT INTO users (user_id, email, display_name, role, auth_provider, password_hash, is_active)
     VALUES ($1,$2,$3,$4,'local',$5,TRUE) ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
    [`local:${roleName}`, email, roleName, roleName, await auth.hashPassword('TestHeslo12345')]
  );
  return (await auth.signIn(email, 'TestHeslo12345')).token;
}

/** Ako je človek spárovaný, priamo z databázy. */
const mapping = async (userId) => (await pool.query(
  'SELECT personal_number, is_external FROM users WHERE user_id = $1', [userId]
)).rows[0];

const setMapping = (token, userId, body) =>
  call('PUT', `/api/quotas/user/${encodeURIComponent(userId)}/mapping`, { token, body });

async function main() {
  await cleanup();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  const hr = await account('zz-pam-hr', ['hr.manage'], 'zz-pam-hr@etilog.local');
  const nikto = await account('zz-pam-nikto', [], 'zz-pam-nikto@etilog.local');

  // Dvaja zamestnanci, ktorých budeme párovať.
  for (const [id, name] of [['zz-pam-anna', 'Anna Testovacia'], ['zz-pam-boris', 'Boris Testovací']]) {
    await pool.query(
      `INSERT INTO users (user_id, email, display_name, role, auth_provider, is_active)
       VALUES ($1, $2, $3, 'user', 'azure', TRUE)`,
      [id, `${id}@etilog.local`, name]
    );
  }

  console.log('\n1. Predvolene je každý interný a nespárovaný');
  check('Anna nemá osobné číslo', await mapping('zz-pam-anna'), { personal_number: null, is_external: false });

  console.log('\n2. Osobné číslo sa uloží');
  const set = await setMapping(hr, 'zz-pam-anna', { personal_number: 412, is_external: false });
  check('prejde', set.status, 200);
  check('je v databáze', await mapping('zz-pam-anna'), { personal_number: 412, is_external: false });
  check('reťazec z formulára sa prijme tiež',
        (await setMapping(hr, 'zz-pam-anna', { personal_number: ' 412 ', is_external: false })).status, 200);

  console.log('\n3. To isté číslo nesmie dostať druhý človek');
  const dupe = await setMapping(hr, 'zz-pam-boris', { personal_number: 412, is_external: false });
  check('odmietne sa', dupe.status, 409);
  check('a povie prečo', typeof dupe.body.message === 'string' && dupe.body.message.length > 0, true);
  check('Boris zostal nespárovaný', await mapping('zz-pam-boris'), { personal_number: null, is_external: false });

  console.log('\n4. Externému sa číslo zahodí');
  check('zapnutie externého prejde',
        (await setMapping(hr, 'zz-pam-anna', { personal_number: 412, is_external: true })).status, 200);
  // Jadro tohto testu. Keby číslo zostalo, nočná synchronizácia by k Anne
  // natiahla kvóty toho, komu 412 patrí v PAM.
  check('číslo je preč', await mapping('zz-pam-anna'), { personal_number: null, is_external: true });

  console.log('\n5. Uvoľnené číslo smie dostať niekto iný');
  check('Boris ho teraz dostane',
        (await setMapping(hr, 'zz-pam-boris', { personal_number: 412, is_external: false })).status, 200);
  check('a má ho', (await mapping('zz-pam-boris')).personal_number, 412);

  console.log('\n6. Čo neprejde');
  check('nula', (await setMapping(hr, 'zz-pam-anna', { personal_number: 0 })).status, 400);
  check('záporné', (await setMapping(hr, 'zz-pam-anna', { personal_number: -5 })).status, 400);
  check('text', (await setMapping(hr, 'zz-pam-anna', { personal_number: 'štyristodvanásť' })).status, 400);
  check('používateľ, ktorý neexistuje',
        (await setMapping(hr, 'zz-pam-niet', { personal_number: 9999 })).status, 404);
  check('bez hr.manage',
        (await setMapping(nikto, 'zz-pam-anna', { personal_number: 7 })).status, 403);
  check('bez prihlásenia',
        (await call('PUT', '/api/quotas/user/zz-pam-anna/mapping', { body: { personal_number: 7 } })).status, 401);

  console.log('\n7. Prázdne číslo znamená „nespárovaný", nie chybu');
  check('prázdny reťazec prejde',
        (await setMapping(hr, 'zz-pam-boris', { personal_number: '', is_external: false })).status, 200);
  check('a číslo je preč', (await mapping('zz-pam-boris')).personal_number, null);

  console.log('\n8. Zoznam kvót nesie párovanie so sebou');
  await setMapping(hr, 'zz-pam-boris', { personal_number: 777, is_external: false });
  const all = await call('GET', `/api/quotas/all?year=${new Date().getFullYear()}`, { token: hr });
  const boris = (all.body.data || []).find((q) => q.user_id === 'zz-pam-boris');
  check('Boris je v zozname', Boolean(boris), true);
  check('aj s osobným číslom', boris?.personal_number, 777);
  check('a s príznakom externého', boris?.is_external, false);
  const anna = (all.body.data || []).find((q) => q.user_id === 'zz-pam-anna');
  check('Anna je označená ako externá', anna?.is_external, true);

  console.log('\n9. Neúspešná synchronizácia neuloží osobné číslo');
  // Tlačidlo Synchronizovať posiela číslo rovno do synchronizácie, ešte
  // neuložené. Uložiť sa smie až keď PAM povie, že to číslo pozná - inak by
  // preklep zostal zapísaný aj po tom, čo vyhľadanie zlyhá, a nočný beh by
  // na ňom padal každé ráno, kým by si toho niekto nevšimol.
  //
  // Tu PAM nie je nastavený vôbec, takže synchronizácia padne na spojení.
  // Pre tento test je to to isté ako neznáme číslo: v oboch prípadoch sa
  // nesmie zapísať nič.
  await setMapping(hr, 'zz-pam-anna', { personal_number: '', is_external: false });
  const before = await mapping('zz-pam-anna');
  const attempt = await call('POST', '/api/quotas/user/zz-pam-anna/pam-sync',
                             { token: hr, body: { personal_number: 99999 } });
  check('synchronizácia neprejde', attempt.status >= 400, true);
  check('a číslo sa neuložilo', await mapping('zz-pam-anna'), before);

  server.close();
}

main()
  .catch((error) => { console.error(error); failures += 1; })
  .then(async () => {
    await cleanup().catch(() => {});
    await pool.end().catch(() => {});
    console.log('');
    console.log(failures
      ? `${RED}${failures} kontrol zlyhalo${OFF}\n`
      : `${GREEN}Všetko prešlo${OFF} - jedno osobné číslo patrí jednému človeku a externý ho nedrží.\n`);
    process.exit(failures ? 1 : 0);
  });
