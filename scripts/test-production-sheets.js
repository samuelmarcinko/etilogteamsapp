#!/usr/bin/env node
/**
 * Správa hárkov vo výrobnom pláne.
 *
 *   node scripts/test-production-sheets.js
 *
 * Hárky sú karty nad plánom a každý z nich je buď jednosmenný, alebo
 * dvojsmenný. Dve veci na tom môžu stáť draho a obe sa tu skúšajú naozaj,
 * proti skutočnej databáze a cez skutočný Express:
 *
 *   Prepnutie dvoch smien na jednu presúva cudziu prácu. Karty z popoludňajšej
 *   musia skončiť v tej jednej, nie zmiznúť za zmazanou smenou - a poznámky,
 *   ktoré niekto napísal, sa nesmú stratiť ani vtedy, keď obe smeny písali v
 *   ten istý deň a do jedného riadka sa zmestí len jedna.
 *
 *   Zmazanie hárku je nenávratné a zoberie so sebou všetko, čo na ňom je.
 *   Server preto pýta späť jeho názov a test overuje, že bez neho - a s
 *   nesprávnym - naozaj nič nezmaže.
 *
 * Skript si vyrobí vlastné hárky a na konci ich po sebe zmaže. Proti inému než
 * lokálnemu serveru sa odmietne spustiť.
 */

require('dotenv').config();

const dbHost = process.env.DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1'].includes(dbHost) && process.env.ALLOW_REMOTE_DB !== 'yes') {
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
    const payload = body ? JSON.stringify(body) : null;
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

// Všetko, čo tento test vyrobí, nesie túto predponu - aby sa upratovanie
// nemohlo dotknúť ničoho skutočného.
const PREFIX = 'ZZTEST_';
const users = [];

async function cleanup() {
  await pool.query('DELETE FROM production_locations WHERE code LIKE $1', [`${PREFIX}%`]);
  if (users.length) await pool.query('DELETE FROM users WHERE user_id = ANY($1)', [users]);
  await pool.query("DELETE FROM roles WHERE name IN ('zz-planner', 'zz-reader')").catch(() => {});
}

/** Účet s presne týmito právami, prihlásený. */
async function account(roleName, permissions, email) {
  const Role = require('../src/database/models/Role');
  await pool.query(
    `INSERT INTO roles (name, label, is_system) VALUES ($1, $1, FALSE) ON CONFLICT (name) DO NOTHING`,
    [roleName]
  );
  await Role.setPermissions(roleName, permissions);
  Role.invalidateCache();

  const id = `local:${roleName}`;
  users.push(id);
  await pool.query(
    `INSERT INTO users (user_id, email, display_name, role, auth_provider, password_hash, is_active)
     VALUES ($1, $2, $3, $4, 'local', $5, TRUE)
     ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
    [id, email, roleName, roleName, await auth.hashPassword('TestHeslo12345')]
  );
  return (await auth.signIn(email, 'TestHeslo12345')).token;
}

const shiftsOf = async (code) => (await pool.query(
  `SELECT s.name FROM production_shifts s
     JOIN production_locations l ON l.id = s.location_id
    WHERE l.code = $1 AND s.is_active ORDER BY s.sort_order`, [code])).rows.map((r) => r.name);

const cardsOf = async (code) => (await pool.query(
  `SELECT e.custom_product_name AS name, s.name AS shift
     FROM production_plan_entries e
     JOIN production_locations l ON l.id = e.location_id
     LEFT JOIN production_shifts s ON s.id = e.shift_id
    WHERE l.code = $1 AND e.deleted_at IS NULL
    ORDER BY e.custom_product_name`, [code])).rows;

const notesOf = async (code) => (await pool.query(
  `SELECT n.note FROM production_shift_notes n
     JOIN production_locations l ON l.id = n.location_id
    WHERE l.code = $1 ORDER BY n.production_date`, [code])).rows.map((r) => r.note);

async function main() {
  await cleanup();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  const planner = await account('zz-planner', ['production.view', 'production.manage'],
                                'zz-planner@etilog.local');
  const reader = await account('zz-reader', ['production.view'], 'zz-reader@etilog.local');

  // ---------------------------------------------------------------- zakladanie
  console.log('\n1. Zakladanie hárkov');

  const twoShift = await call('POST', '/api/production/sheets', {
    token: planner, body: { code: `${PREFIX}DVE`, name: 'Dvojsmenná', shiftMode: 'double' }
  });
  check('dvojsmenný sa založí', twoShift.status, 201);
  check('a hlási sa ako dvojsmenný', twoShift.body.data?.shift_mode, 'double');
  check('v databáze má dve smeny', await shiftsOf(`${PREFIX}DVE`), ['Morning', 'Afternoon']);

  const oneShift = await call('POST', '/api/production/sheets', {
    token: planner, body: { code: `${PREFIX}JEDNA`, name: 'Jednosmenná', shiftMode: 'single' }
  });
  check('jednosmenný sa založí', oneShift.status, 201);
  check('a má práve jednu smenu', await shiftsOf(`${PREFIX}JEDNA`), ['Morning']);

  check('ten istý kód druhýkrát neprejde',
        (await call('POST', '/api/production/sheets', {
          token: planner, body: { code: `${PREFIX}DVE`, name: 'Iná', shiftMode: 'single' }
        })).status, 409);
  // Veľkosť písmen je to jediné, čo sa opravuje namiesto odmietnutia - vo
  // formulári sa kód prepisuje na veľké písmená počas písania, takže uložené
  // je to, čo admin videl.
  const lower = await call('POST', '/api/production/sheets', {
    token: planner, body: { code: `${PREFIX.toLowerCase()}male`, name: 'Malé písmená' }
  });
  check('kód malými písmenami sa uloží veľkými', lower.body.data?.code, `${PREFIX}MALE`);
  check('medzera v kóde neprejde',
        (await call('POST', '/api/production/sheets', {
          token: planner, body: { code: `${PREFIX}S MEDZEROU`, name: 'X' }
        })).status, 400);
  check('hárok bez názvu neprejde',
        (await call('POST', '/api/production/sheets', {
          token: planner, body: { code: `${PREFIX}X`, name: '  ' }
        })).status, 400);

  // ------------------------------------------------- prepnutie na jednu smenu
  console.log('\n2. Z dvoch smien na jednu sa nesmie nič stratiť');

  const { rows: [{ id: locId }] } = await pool.query(
    'SELECT id FROM production_locations WHERE code = $1', [`${PREFIX}DVE`]);
  const { rows: shiftRows } = await pool.query(
    'SELECT id, name FROM production_shifts WHERE location_id = $1 ORDER BY sort_order', [locId]);
  const morning = shiftRows[0].id;
  const afternoon = shiftRows[1].id;

  const DAY = '2026-11-02';
  for (const [shift, name] of [[morning, 'RANNA-1'], [morning, 'RANNA-2'], [afternoon, 'POOBEDE-1']]) {
    await pool.query(
      `INSERT INTO production_plan_entries (location_id, production_date, shift_id, custom_product_name)
       VALUES ($1, $2, $3, $4)`, [locId, DAY, shift, name]);
  }
  // Obe smeny píšu poznámku v ten istý deň - do jedného riadka sa zmestí len
  // jedna, a práve tam sa text najľahšie stratí.
  for (const [shift, note] of [[morning, 'rano: odstavka linky'], [afternoon, 'poobede: nabeh']]) {
    await pool.query(
      `INSERT INTO production_shift_notes (location_id, production_date, shift_id, note)
       VALUES ($1, $2, $3, $4)`, [locId, DAY, shift, note]);
  }

  const toSingle = await call('PUT', `/api/production/sheets/${PREFIX}DVE/shift-mode`, {
    token: planner, body: { shiftMode: 'single' }
  });
  check('prepnutie prejde', toSingle.status, 200);
  check('povie, koľko kariet presunulo', toSingle.body.data?.movedEntries, 1);
  check('zostala jedna smena', await shiftsOf(`${PREFIX}DVE`), ['Morning']);

  const merged = await cardsOf(`${PREFIX}DVE`);
  check('všetky tri karty sú tam', merged.map((c) => c.name),
        ['POOBEDE-1', 'RANNA-1', 'RANNA-2']);
  check('a všetky v tej jednej smene', [...new Set(merged.map((c) => c.shift))], ['Morning']);

  const notes = await notesOf(`${PREFIX}DVE`);
  check('zostal jeden riadok poznámky', notes.length, 1);
  check('ranná poznámka v ňom je', notes[0]?.includes('odstavka linky'), true);
  check('popoludňajšia tiež', notes[0]?.includes('nabeh'), true);

  // ------------------------------------------------- prepnutie späť na dve
  console.log('\n3. Späť na dve smeny');

  const toDouble = await call('PUT', `/api/production/sheets/${PREFIX}DVE/shift-mode`, {
    token: planner, body: { shiftMode: 'double' }
  });
  check('prepnutie prejde', toDouble.status, 200);
  check('popoludňajšia pribudla', await shiftsOf(`${PREFIX}DVE`), ['Morning', 'Afternoon']);
  check('nič sa nepresúvalo', toDouble.body.data?.movedEntries, 0);
  check('karty ostali na rannej',
        [...new Set((await cardsOf(`${PREFIX}DVE`)).map((c) => c.shift))], ['Morning']);

  check('to isté nastavenie druhýkrát nič neurobí',
        (await call('PUT', `/api/production/sheets/${PREFIX}DVE/shift-mode`, {
          token: planner, body: { shiftMode: 'double' }
        })).body.data?.changed, false);
  check('neznámy režim neprejde',
        (await call('PUT', `/api/production/sheets/${PREFIX}DVE/shift-mode`, {
          token: planner, body: { shiftMode: 'trojsmenna' }
        })).status, 400);

  // ------------------------------------------------------- názov a poradie
  console.log('\n4. Premenovanie a poradie');

  check('premenovanie prejde',
        (await call('PATCH', `/api/production/sheets/${PREFIX}JEDNA`, {
          token: planner, body: { name: 'Prebaľovňa' }
        })).body.data?.name, 'Prebaľovňa');
  check('prázdny názov neprejde',
        (await call('PATCH', `/api/production/sheets/${PREFIX}JEDNA`, {
          token: planner, body: { name: '   ' }
        })).status, 400);

  // Len tie dva, o ktorých je táto časť - zoznam obsahuje aj hárok z kontroly
  // veľkosti písmen a ten by tu len zavadzal.
  const ORDERED = [`${PREFIX}DVE`, `${PREFIX}JEDNA`];
  const order = async () => (await call('GET', '/api/production/sheets', { token: planner }))
    .body.data.filter((s) => ORDERED.includes(s.code)).map((s) => s.code);

  check('oba hárky sú na konci zoznamu', await order(), [`${PREFIX}DVE`, `${PREFIX}JEDNA`]);
  await call('POST', `/api/production/sheets/${PREFIX}JEDNA/move`, {
    token: planner, body: { direction: 'up' }
  });
  check('šípka hore ich prehodí', await order(), [`${PREFIX}JEDNA`, `${PREFIX}DVE`]);
  await call('POST', `/api/production/sheets/${PREFIX}JEDNA/move`, {
    token: planner, body: { direction: 'down' }
  });
  check('a šípka dole vráti', await order(), [`${PREFIX}DVE`, `${PREFIX}JEDNA`]);

  check('skrytý hárok zmizne z kariet, nie zo správy', await (async () => {
    await call('PATCH', `/api/production/sheets/${PREFIX}JEDNA`, {
      token: planner, body: { isActive: false }
    });
    const tabs = (await call('GET', '/api/production/locations', { token: planner }))
      .body.data.some((l) => l.code === `${PREFIX}JEDNA`);
    const admin = (await call('GET', '/api/production/sheets', { token: planner }))
      .body.data.some((s) => s.code === `${PREFIX}JEDNA`);
    return { vKartach: tabs, vSprave: admin };
  })(), { vKartach: false, vSprave: true });

  // -------------------------------------------------------------- mazanie
  console.log('\n5. Mazanie pýta názov späť');

  const contents = await call('GET', `/api/production/sheets/${PREFIX}DVE/contents`, { token: planner });
  check('povie, čo na hárku je', contents.body.data?.entries, 3);
  check('a že prázdny nie je', contents.body.data?.isEmpty, false);

  check('bez potvrdenia nezmaže',
        (await call('DELETE', `/api/production/sheets/${PREFIX}DVE`, { token: planner })).status, 400);
  check('so zlým názvom nezmaže',
        (await call('DELETE', `/api/production/sheets/${PREFIX}DVE?confirm=Dvojsmena`, { token: planner })).status, 400);
  check('hárok je po oboch pokusoch stále tam', (await cardsOf(`${PREFIX}DVE`)).length, 3);

  const deleted = await call('DELETE',
    `/api/production/sheets/${PREFIX}DVE?confirm=${encodeURIComponent('Dvojsmenná')}`, { token: planner });
  check('so správnym názvom zmaže', deleted.status, 200);
  check('hárok je preč',
        (await pool.query('SELECT 1 FROM production_locations WHERE code = $1', [`${PREFIX}DVE`])).rowCount, 0);
  check('a karty odišli s ním', (await cardsOf(`${PREFIX}DVE`)).length, 0);

  // ---------------------------------------------------------------- práva
  console.log('\n6. Kto na to smie');

  check('samotné production.view na zoznam hárkov nestačí',
        (await call('GET', '/api/production/sheets', { token: reader })).status, 403);
  check('ani na založenie',
        (await call('POST', '/api/production/sheets', {
          token: reader, body: { code: `${PREFIX}NESMIE`, name: 'Nesmie' }
        })).status, 403);
  check('ani na zmazanie',
        (await call('DELETE',
          `/api/production/sheets/${PREFIX}JEDNA?confirm=${encodeURIComponent('Prebaľovňa')}`,
          { token: reader })).status, 403);
  check('bez prihlásenia už vôbec nie',
        (await call('GET', '/api/production/sheets')).status, 401);
  check('hárok, ktorý neexistuje, je 404',
        (await call('GET', `/api/production/sheets/${PREFIX}NIET/contents`, { token: planner })).status, 404);

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
      : `${GREEN}Všetko prešlo${OFF} - hárky sa dajú spravovať a nič sa pri tom nestráca.\n`);
    process.exit(failures ? 1 : 0);
  });
