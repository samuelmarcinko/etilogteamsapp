#!/usr/bin/env node
/**
 * Duplikovanie karty vo výrobnom pláne.
 *
 *   node scripts/test-production-duplicate.js
 *
 * Plánovač klikne pravým na kartu a dá Duplicate - chce tú istú prácu ešte
 * raz. „Presná kópia" je pritom tvrdenie, ktoré sa dá overiť len tým, že sa
 * obe karty porovnajú pole po poli: keby sa raz do tabuľky pridal stĺpec a na
 * kopírovanie sa zabudlo, kópia by vyzerala správne a líšila by sa v niečom,
 * čo na nej nevidno - v poznámke, v naviazanej SAP objednávke, v termíne.
 * Preto sa tu nekontroluje zoznam polí, ktoré ma napadli, ale celý riadok.
 *
 * Dve veci sa kopírovať nemajú a test stráži aj to: stav sa vracia na
 * `planned`, lebo duplikát je práca, ktorá ešte len bude, a autorstvo patrí
 * tomu, kto kópiu urobil.
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

const CODE = 'ZZDUP';
const users = [];

async function cleanup() {
  await pool.query('DELETE FROM production_locations WHERE code = $1', [CODE]);
  if (users.length) await pool.query('DELETE FROM users WHERE user_id = ANY($1)', [users]);
  await pool.query("DELETE FROM roles WHERE name IN ('zz-dup-planner', 'zz-dup-reader')").catch(() => {});
}

async function account(roleName, permissions, email) {
  const Role = require('../src/database/models/Role');
  await pool.query('INSERT INTO roles (name, label, is_system) VALUES ($1, $1, FALSE) ON CONFLICT (name) DO NOTHING',
                   [roleName]);
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

const row = async (id) => (await pool.query('SELECT * FROM production_plan_entries WHERE id = $1', [id])).rows[0];

/**
 * Polia, ktoré sa od originálu líšiť musia alebo smú.
 *
 * Všetko ostatné sa porovnáva automaticky, takže nový stĺpec v tabuľke tento
 * test zhodí, kým sa nerozhodne, či sa má kopírovať - čo je presne tá otázka,
 * na ktorú by inak nikto neprišiel.
 */
const EXPECTED_DIFFERENCES = new Set([
  'id', 'sort_order', 'status', 'version',
  'created_at', 'updated_at', 'created_by', 'created_by_name', 'updated_by', 'updated_by_name'
]);

async function main() {
  await cleanup();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  const planner = await account('zz-dup-planner', ['production.view', 'production.manage'],
                                'zz-dup-planner@etilog.local');
  const reader = await account('zz-dup-reader', ['production.view'], 'zz-dup-reader@etilog.local');

  // --- hárok a karta, ktorá má čo kopírovať
  const { rows: [location] } = await pool.query(
    `INSERT INTO production_locations (code, name, is_internal, is_active, sort_order)
     VALUES ($1, 'Duplikát (test)', TRUE, TRUE, 9000) RETURNING id`, [CODE]);
  const { rows: [shift] } = await pool.query(
    `INSERT INTO production_shifts (location_id, name, sort_order)
     VALUES ($1, 'Morning', 10) RETURNING id`, [location.id]);

  const DAY = '2026-11-16';
  // Karta s vyplneným všetkým, čo sa dá vyplniť - prázdne polia by o
  // kopírovaní nepovedali nič.
  const { rows: [original] } = await pool.query(
    `INSERT INTO production_plan_entries
       (location_id, production_date, shift_id, custom_product_name, planned_quantity,
        priority, color, status, notes, due_date, sap_order_entry, sort_order,
        created_by, created_by_name, updated_by, updated_by_name)
     VALUES ($1, $2, $3, 'TESLA ABD', 240, 'urgent', 'violet', 'done',
             'dvojitá kontrola pred expedíciou', '2026-11-20', 4711, 0,
             'kto:povodny', 'Pôvodný autor', 'kto:povodny', 'Pôvodný autor')
     RETURNING *`,
    [location.id, DAY, shift.id]);

  // Druhá karta v tom istom políčku, aby bolo vidieť, kam kópia sadne.
  await pool.query(
    `INSERT INTO production_plan_entries
       (location_id, production_date, shift_id, custom_product_name, planned_quantity, sort_order)
     VALUES ($1, $2, $3, 'INÁ PRÁCA', 10, 1)`,
    [location.id, DAY, shift.id]);

  console.log('\n1. Kópia je kópia');

  const made = await call('POST', `/api/production/entries/${original.id}/duplicate`, { token: planner });
  check('duplikovanie prejde', made.status, 200);

  const copy = await row(made.body.data?.id);
  check('kópia v databáze je', Boolean(copy), true);

  // Porovnanie celého riadka - nie zoznamu polí, ktoré ma napadli.
  const differing = Object.keys(original)
    .filter((key) => JSON.stringify(original[key]) !== JSON.stringify(copy?.[key]))
    .filter((key) => !EXPECTED_DIFFERENCES.has(key))
    .sort();
  check('žiadne iné pole sa nelíši', differing, []);

  check('rovnaký produkt', copy?.custom_product_name, original.custom_product_name);
  check('rovnaké množstvo', Number(copy?.planned_quantity), 240);
  check('rovnaká priorita', copy?.priority, 'urgent');
  check('rovnaká farba', copy?.color, 'violet');
  check('rovnaká poznámka', copy?.notes, original.notes);
  check('rovnaká SAP objednávka', copy?.sap_order_entry, 4711);

  console.log('\n2. Čo sa kopírovať nemá');
  check('stav sa vráti na plánované', copy?.status, 'planned');
  check('autorom je ten, kto kópiu urobil', copy?.created_by, 'local:zz-dup-planner');
  check('a nie pôvodný autor', copy?.created_by === original.created_by, false);

  console.log('\n3. Kam kópia sadne');
  check('do toho istého dňa', copy?.production_date?.toISOString().slice(0, 10), DAY);
  check('do tej istej smeny', copy?.shift_id, shift.id);
  const slot = (await pool.query(
    `SELECT custom_product_name FROM production_plan_entries
      WHERE location_id = $1 AND production_date = $2 AND deleted_at IS NULL
      ORDER BY sort_order`, [location.id, DAY])).rows.map((r) => r.custom_product_name);
  check('a na spodok políčka, nie medzi ostatné',
        slot, ['TESLA ABD', 'INÁ PRÁCA', 'TESLA ABD']);

  console.log('\n4. Späť');
  const undo = made.body.undo;
  check('ponuka Späť je v odpovedi', Array.isArray(undo?.deleteIds) && undo.deleteIds.length === 1, true);
  check('a nič iné vracať netreba', undo?.positions, undefined);

  check('vrátenie prejde',
        (await call('POST', '/api/production/entries/undo', { token: planner, body: undo })).status, 200);
  check('kópia je preč', (await row(copy.id))?.deleted_at !== null, true);
  check('originál zostal nedotknutý', (await row(original.id))?.deleted_at, null);

  console.log('\n5. Čo sa duplikovať nedá');
  check('karta, ktorá neexistuje, je 404',
        (await call('POST', '/api/production/entries/999999999/duplicate', { token: planner })).status, 404);
  check('zmazaná karta tiež',
        (await call('POST', `/api/production/entries/${copy.id}/duplicate`, { token: planner })).status, 404);
  check('samotné production.view nestačí',
        (await call('POST', `/api/production/entries/${original.id}/duplicate`, { token: reader })).status, 403);
  check('bez prihlásenia už vôbec nie',
        (await call('POST', `/api/production/entries/${original.id}/duplicate`)).status, 401);

  console.log('\n6. Zmena je v histórii');
  const activity = await call('GET', `/api/production/activity?location=${CODE}&limit=5`, { token: planner });
  check('duplikovanie sa zapísalo',
        (activity.body.data || []).some((e) => (e.summary || '').includes('Duplicated')), true);

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
      : `${GREEN}Všetko prešlo${OFF} - kópia je presná a dá sa vrátiť.\n`);
    process.exit(failures ? 1 : 0);
  });
