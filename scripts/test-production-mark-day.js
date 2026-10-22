#!/usr/bin/env node
/**
 * Uzavretie celého dňa jedným kliknutím.
 *
 *   node scripts/test-production-mark-day.js
 *
 * Majster na konci smeny nepotvrdzuje osem kariet po jednej. Z ponuky dňa sa
 * uzavrie celý deň naraz, naprieč smenami - lebo otázka znie „bol tento deň
 * odrobený?", nie „bola odrobená ranná?".
 *
 * Najdôležitejšia je tu tá časť o vrátení späť. Deň zvyčajne nie je celý
 * rozrobený: niečo na ňom už hotové je, lebo to niekto zavrel včera. Keby
 * Späť znamenalo „otvor všetko, čo je na dni hotové", vrátilo by aj tie karty
 * - a plánovač by o včerajšiu prácu prišiel bez toho, aby si toho všimol,
 * lebo na obrazovke by videl presne to, čo čakal: otvorený deň.
 *
 * Preto sa snímka berie len z kariet, ktoré sa naozaj menili, a nesie stav,
 * ktorý karta mala. Test to skúša na dni, kde sú všetky tri stavy naraz.
 *
 * Skript si vyrobí vlastný hárok aj karty a na konci ich po sebe zmaže. Proti
 * inému než lokálnemu serveru sa odmietne spustiť.
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

const CODE = 'ZZDAY';
const DAY = '2026-12-07';
const NEXT = '2026-12-08';
const users = [];

async function cleanup() {
  await pool.query('DELETE FROM production_locations WHERE code = $1', [CODE]);
  if (users.length) await pool.query('DELETE FROM users WHERE user_id = ANY($1)', [users]);
  await pool.query("DELETE FROM roles WHERE name IN ('zz-day-planner','zz-day-reader')").catch(() => {});
}

async function account(roleName, permissions, email) {
  const Role = require('../src/database/models/Role');
  await pool.query('INSERT INTO roles (name, label, is_system) VALUES ($1,$1,FALSE) ON CONFLICT (name) DO NOTHING',
                   [roleName]);
  await Role.setPermissions(roleName, permissions);
  Role.invalidateCache();

  const id = `local:${roleName}`;
  users.push(id);
  await pool.query(
    `INSERT INTO users (user_id, email, display_name, role, auth_provider, password_hash, is_active)
     VALUES ($1,$2,$3,$4,'local',$5,TRUE) ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
    [id, email, roleName, roleName, await auth.hashPassword('TestHeslo12345')]
  );
  return (await auth.signIn(email, 'TestHeslo12345')).token;
}

/** Stavy kariet na jednom dni, podľa mena - nezávisle od poradia. */
const statuses = async (locationId, date) => Object.fromEntries(
  (await pool.query(
    `SELECT custom_product_name AS name, status FROM production_plan_entries
      WHERE location_id = $1 AND production_date = $2 AND deleted_at IS NULL
      ORDER BY custom_product_name`, [locationId, date])).rows.map((r) => [r.name, r.status])
);

async function main() {
  await cleanup();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  const planner = await account('zz-day-planner', ['production.view', 'production.manage'],
                                'zz-day-planner@etilog.local');
  const reader = await account('zz-day-reader', ['production.view'], 'zz-day-reader@etilog.local');

  const { rows: [location] } = await pool.query(
    `INSERT INTO production_locations (code, name, is_internal, is_active, sort_order)
     VALUES ($1, 'Uzavretie dna (test)', TRUE, TRUE, 9200) RETURNING id`, [CODE]);
  const { rows: shifts } = await pool.query(
    `INSERT INTO production_shifts (location_id, name, sort_order)
     VALUES ($1,'Morning',10), ($1,'Afternoon',20) RETURNING id`, [location.id]);
  const [morning, afternoon] = shifts.map((s) => s.id);

  const card = (shift, name, status, date = DAY) => pool.query(
    `INSERT INTO production_plan_entries
       (location_id, production_date, shift_id, custom_product_name, planned_quantity, status, sort_order)
     VALUES ($1,$2,$3,$4,10,$5,0)`, [location.id, date, shift, name, status]);

  // Deň, na ktorom je aj karta zavretá už skôr - to je ten prípad, kde sa
  // vrátenie späť dá ľahko pokaziť. Stavy sú od migrácie 029 len dva:
  // naplánovaná a hotová.
  await card(morning, 'RANNA-PLAN', 'planned');
  await card(morning, 'RANNA-UZ-HOTOVA', 'done');
  await card(afternoon, 'POOBEDE-PLAN', 'planned');
  // A susedný deň, ktorého sa to nesmie dotknúť.
  await card(morning, 'ZAJTRA-PLAN', 'planned', NEXT);

  console.log('\n1. Uzavretie dňa');
  const done = await call('POST', '/api/production/bulk/mark-day-done', {
    token: planner, body: { location: CODE, date: DAY }
  });
  check('prejde', done.status, 200);
  check('označilo dve karty, nie tri', done.body.data?.marked, 2);
  check('celý deň je hotový', await statuses(location.id, DAY), {
    'POOBEDE-PLAN': 'done', 'RANNA-PLAN': 'done', 'RANNA-UZ-HOTOVA': 'done'
  });
  check('platí naprieč smenami, nielen na rannej', (await statuses(location.id, DAY))['POOBEDE-PLAN'], 'done');
  check('susedného dňa sa to nedotklo', await statuses(location.id, NEXT), { 'ZAJTRA-PLAN': 'planned' });

  console.log('\n2. Späť vráti len to, čo sa menilo');
  const undo = done.body.undo;
  check('snímka je na dve karty', undo?.positions?.length, 2);
  check('a nesie stav, ktorý mali',
        undo.positions.map((p) => p.status).sort(), ['planned', 'planned']);

  check('vrátenie prejde',
        (await call('POST', '/api/production/entries/undo', { token: planner, body: undo })).status, 200);

  // Jadro testu: karta, ktorá bola hotová už predtým, musí hotová zostať.
  // Keby Späť znamenalo „otvor všetko", plánovač by o včerajšiu prácu prišiel
  // a na obrazovke by videl presne to, čo čakal - otvorený deň.
  check('každá karta je tam, kde bola', await statuses(location.id, DAY), {
    'POOBEDE-PLAN': 'planned', 'RANNA-PLAN': 'planned', 'RANNA-UZ-HOTOVA': 'done'
  });

  console.log('\n3. Deň, na ktorom nie je čo zavrieť');
  await call('POST', '/api/production/bulk/mark-day-done', { token: planner, body: { location: CODE, date: DAY } });
  const again = await call('POST', '/api/production/bulk/mark-day-done', {
    token: planner, body: { location: CODE, date: DAY }
  });
  check('druhýkrát sa povie, že nie je čo', again.status, 400);
  check('prázdny deň tiež',
        (await call('POST', '/api/production/bulk/mark-day-done', {
          token: planner, body: { location: CODE, date: '2026-12-24' }
        })).status, 400);

  console.log('\n4. Čo neprejde');
  check('zlý tvar dátumu',
        (await call('POST', '/api/production/bulk/mark-day-done', {
          token: planner, body: { location: CODE, date: '7.12.2026' }
        })).status, 400);
  check('hárok, ktorý neexistuje',
        (await call('POST', '/api/production/bulk/mark-day-done', {
          token: planner, body: { location: 'ZZNIET', date: DAY }
        })).status, 404);
  check('samotné production.view nestačí',
        (await call('POST', '/api/production/bulk/mark-day-done', {
          token: reader, body: { location: CODE, date: NEXT }
        })).status, 403);
  check('bez prihlásenia už vôbec nie',
        (await call('POST', '/api/production/bulk/mark-day-done', { body: { location: CODE, date: NEXT } })).status, 401);

  console.log('\n5. Zmena je v histórii');
  const activity = await call('GET', `/api/production/activity?location=${CODE}&limit=10`, { token: planner });
  check('uzavretie dňa sa zapísalo',
        (activity.body.data || []).some((e) => (e.summary || '').includes('as done')), true);

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
      : `${GREEN}Všetko prešlo${OFF} - deň sa zavrie naraz a Späť vráti každú kartu tam, kde bola.\n`);
    process.exit(failures ? 1 : 0);
  });
