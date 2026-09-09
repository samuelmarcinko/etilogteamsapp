#!/usr/bin/env node
/**
 * Vyskladnenie - celá cesta cez server.
 *
 *   node scripts/test-withdrawals-http.js
 *
 * Model aj obrazovka sú overené zvlášť; toto overuje to medzi nimi - práva,
 * odomykací zámok a tvar odpovedí, na ktorý sa obrazovka spolieha. Beží to
 * proti skutočnému Expressu s reálnym prihlásením, nie proti napodobenine.
 *
 * Práve toto odhalilo, že nové právo musí prejsť aj cez zoznam v databáze:
 * bez toho sa `warehouse.withdraw` nedalo prideliť žiadnej role a majstri by
 * sa na tablet nedostali, hoci v kóde bolo všetko na mieste.
 *
 * Skript si vyrobí vlastné riadky a na konci ich po sebe zmaže. Proti inému
 * než lokálnemu serveru sa odmietne spustiť.
 */

require('dotenv').config();

const dbHost = process.env.DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1'].includes(dbHost) && process.env.ALLOW_REMOTE_DB !== 'yes') {
  console.error(`\nOdmietam bežať proti ${dbHost}. Toto je test, nie nástroj na produkčné dáta.\n`);
  process.exit(1);
}

// Bez tajomstva sa lokálne prihlásenie nezapne a test by nemal ako začať.
process.env.LOCAL_AUTH_SECRET ||= require('crypto').randomBytes(48).toString('base64');

process.env.MICROSOFT_APP_ID ||= '00000000-0000-0000-0000-000000000000';
process.env.MICROSOFT_APP_PASSWORD ||= 'test';
process.env.TENANT_ID ||= '00000000-0000-0000-0000-000000000000';
process.env.CLIENT_ID ||= process.env.MICROSOFT_APP_ID;
process.env.LOG_LEVEL = 'error';

const http = require('http');
const pool = require('../src/database/config');
const auth = require('../src/services/localAuthService');
const app = require('../src/index');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `  cakalo ${JSON.stringify(expected)}, prislo ${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
};

let port;
function call(method, path, { token, unlock, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port, path, method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(unlock ? { 'X-Unlock-Token': unlock } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }); }
                            catch { resolve({ status: res.statusCode, body: raw }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const made = { materials: [], locations: [], users: [] };

async function cleanup() {
  if (made.materials.length) {
    await pool.query('DELETE FROM warehouse_withdrawals WHERE material_id = ANY($1)', [made.materials]);
    await pool.query('DELETE FROM material_placements WHERE material_id = ANY($1)', [made.materials]);
    await pool.query('DELETE FROM materials WHERE id = ANY($1)', [made.materials]);
  }
  if (made.locations.length) await pool.query('DELETE FROM pallet_locations WHERE id = ANY($1)', [made.locations]);
  if (made.users.length) await pool.query('DELETE FROM users WHERE user_id = ANY($1)', [made.users]);
  await pool.query("DELETE FROM roles WHERE name = 'zz-majster'").catch(() => {});
}

async function main() {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;

  // --- rola pre majstrov: len vyskladnenie, nič iné
  await pool.query(`INSERT INTO roles (name, label, is_system) VALUES ('zz-majster', 'Majster (test)', FALSE)
                    ON CONFLICT (name) DO NOTHING`);
  const Role = require('../src/database/models/Role');
  await Role.setPermissions('zz-majster', ['warehouse.withdraw']);
  Role.invalidateCache();

  // --- účet tabletu
  const tabletId = 'local:zz-tablet';
  made.users.push(tabletId);
  await pool.query(
    `INSERT INTO users (user_id, email, display_name, role, auth_provider, is_kiosk, password_hash, is_active)
     VALUES ($1, 'zz-tablet@etilog.local', 'Tablet sklad', 'zz-majster', 'local', TRUE, $2, TRUE)`,
    [tabletId, await auth.hashPassword('TabletHeslo12345')]
  );
  await auth.setPin(tabletId, '4831');

  const signed = await auth.signIn('zz-tablet@etilog.local', 'TabletHeslo12345');
  const token = signed.token;

  // --- materiál
  const loc = async (code, zone, pos) => {
    const { rows } = await pool.query(
      'INSERT INTO pallet_locations (code, zone, position) VALUES ($1,$2,$3) RETURNING id', [code, zone, pos]);
    made.locations.push(rows[0].id);
    return rows[0].id;
  };
  const b1 = await loc('ZZ-HTTP-1', 'C', 951);
  const { rows: mrows } = await pool.query(
    `INSERT INTO materials (code, name, kind, unit, quantity, sap_item_code)
     VALUES ('ZZHTTP-RM', 'HTTP kartón', 'sap', 'ks', 100, 'ZZHTTP-RM') RETURNING id`);
  made.materials.push(mrows[0].id);
  await pool.query('INSERT INTO material_placements (material_id, location_id, quantity) VALUES ($1,$2,100)',
    [mrows[0].id, b1]);

  console.log('\n1. Prihlásenie tabletu');
  check('prihlásenie prešlo', typeof token, 'string');
  const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).exp;
  const days = Math.round((exp * 1000 - Date.now()) / 86400000);
  check('platí dlho (dni)', days > 300, true);
  check('heslo si meniť nemusí', signed.mustChangePassword, false);

  console.log('\n2. Práva');
  const session = await call('GET', '/api/warehouse/withdrawals/session', { token });
  check('na vyskladnenie právo má', session.status, 200);
  check('vie, že je to tablet', session.body.data.kiosk, true);
  check('vie, že PIN je nastavený', session.body.data.hasPin, true);
  check('do evidencie materiálu nesmie', (await call('GET', '/api/warehouse/materials', { token })).status, 403);
  check('do histórie vyskladnení nesmie', (await call('GET', '/api/warehouse/withdrawals', { token })).status, 403);

  console.log('\n3. Zámok');
  const noPin = await call('POST', '/api/warehouse/withdrawals', {
    token, body: { materialId: mrows[0].id, locationId: b1, quantity: 5 } });
  check('bez PINu sa nevyskladní', noPin.status, 423);

  const badPin = await call('POST', '/api/warehouse/withdrawals/unlock', { token, body: { pin: '0000' } });
  check('zlý PIN neodomkne', badPin.status, 401);
  const okPin = await call('POST', '/api/warehouse/withdrawals/unlock', { token, body: { pin: '4831' } });
  check('správny PIN odomkne', okPin.status, 200);
  const unlock = okPin.body.data.unlockToken;

  console.log('\n4. Výdaj');
  const search = await call('GET', '/api/warehouse/withdrawals/search?q=ZZHTTP-RM', { token });
  check('hľadanie nájde materiál', search.body.data.length, 1);
  check('vráti pozíciu aj so zónou', search.body.data[0].placements[0].zone, 'C');

  const out = await call('POST', '/api/warehouse/withdrawals', {
    token, unlock, body: { materialId: mrows[0].id, locationId: b1, quantity: 20 } });
  check('výdaj prešiel', out.status, 201);
  const after = await pool.query('SELECT quantity FROM material_placements WHERE material_id = $1', [mrows[0].id]);
  check('počet klesol', after.rows[0].quantity, 80);

  const tooMuch = await call('POST', '/api/warehouse/withdrawals', {
    token, unlock, body: { materialId: mrows[0].id, locationId: b1, quantity: 999 } });
  check('nad stav sa odmietne', tooMuch.status, 409);
  check('a povie koľko tam je', tooMuch.body.available, 80);

  console.log('\n5. Skladník');
  const sklad = 'local:zz-sklad';
  made.users.push(sklad);
  await pool.query(
    `INSERT INTO users (user_id, email, display_name, role, auth_provider, password_hash, is_active)
     VALUES ($1, 'zz-sklad@etilog.local', 'Skladník', 'sklad', 'local', $2, TRUE)`,
    [sklad, await auth.hashPassword('SkladnikHeslo12')]
  );
  const skladToken = (await auth.signIn('zz-sklad@etilog.local', 'SkladnikHeslo12')).token;

  const list = await call('GET', '/api/warehouse/withdrawals?search=ZZHTTP', { token: skladToken });
  check('skladník históriu vidí', list.status, 200);
  check('je v nej ten výdaj', list.body.data.length, 1);

  const fresh = await call('GET', '/api/warehouse/withdrawals/new', { token: skladToken });
  check('lišta ho ohlási', fresh.body.data.some(w => w.material_name === 'HTTP kartón'), true);

  const void1 = await call('POST', `/api/warehouse/withdrawals/${out.body.data.id}/void`,
    { token: skladToken, body: { reason: 'test' } });
  check('storno prejde', void1.status, 200);
  const back = await pool.query('SELECT quantity FROM material_placements WHERE material_id = $1', [mrows[0].id]);
  check('počet sa vrátil', back.rows[0].quantity, 100);

  const voidByTablet = await call('POST', `/api/warehouse/withdrawals/${out.body.data.id}/void`, { token, unlock });
  check('tablet stornovať nesmie', voidByTablet.status, 403);

  server.close();
}

main()
  .catch(e => { console.error(e); failures += 1; })
  .then(cleanup)
  .then(() => {
    console.log(failures ? `\n${failures} kontrol zlyhalo\n` : '\nVšetko prešlo\n');
    process.exitCode = failures ? 1 : 0;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode || 0), 300));
