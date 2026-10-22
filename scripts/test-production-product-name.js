#!/usr/bin/env node
/**
 * Názov projektu sa doplní aj pre dokončené projekty.
 *
 *   node scripts/test-production-product-name.js
 *
 * Projekt, ktorý má otvorenú výrobnú objednávku, si názov nesie so sebou.
 * Projekt, na ktorom je už všetko vyrobené, ho nenesie - a nie je ani v našej
 * zrkadlovej kópii, lebo tú plná synchronizácia prestavuje práve z otvorených
 * objednávok. Karta potom skončila s prázdnym popisom a nikto nevedel prečo,
 * hoci názov v SAPe celý čas bol.
 *
 * Práve to je bežný prípad: plánuje sa opakovaná výroba niečoho, čo sa už raz
 * vyrobilo.
 *
 * Druhá polovica testu je tá dôležitejšia. Doplnenie názvu je zdvorilosť, nie
 * podmienka - keď je SAP nedostupný alebo kód nepozná, karta musí vzniknúť aj
 * tak. Prázdny popis je kozmetická strata; neuložená karta je stratená práca.
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

process.env.LOCAL_AUTH_SECRET ||= require('crypto').randomBytes(48).toString('base64');
process.env.MICROSOFT_APP_ID ||= '00000000-0000-0000-0000-000000000000';
process.env.MICROSOFT_APP_PASSWORD ||= 'test';
process.env.TENANT_ID ||= '00000000-0000-0000-0000-000000000000';
process.env.CLIENT_ID ||= process.env.MICROSOFT_APP_ID;
process.env.LOG_LEVEL = 'error';
process.env.ACCESS_CONTROL_MODE ||= 'enforce';
// Zámerne vypnutý: tým sa skúša práve tá cesta, kde sa do SAPu ísť nedá.
process.env.SAP_ENABLED = 'false';

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

// FG kódy, ktoré v skutočnosti neexistujú - aby sa test nikdy nechytil
// skutočného projektu.
const MIRRORED = 'FG999001';   // v zrkadle je, názov má
const FINISHED = 'FG999002';   // v zrkadle nie je a SAP je vypnutý
const TOLD = 'FG999003';       // názov príde v požiadavke
const KEPT = 'FG999004';       // popis už má a nemá sa prepísať
const EMPTY = 'FG999005';      // v zozname už je, ale s prázdnym popisom
const SILENT = 'FG999006';     // popis má, ale SAP o kóde nevie

const CODES = [MIRRORED, FINISHED, TOLD, KEPT, EMPTY, SILENT];
const users = [];

async function cleanup() {
  await pool.query('DELETE FROM products WHERE fg_number = ANY($1)', [CODES]);
  await pool.query('DELETE FROM sap_items WHERE item_code = ANY($1)', [CODES]);
  if (users.length) await pool.query('DELETE FROM users WHERE user_id = ANY($1)', [users]);
  await pool.query("DELETE FROM roles WHERE name = 'zz-name-planner'").catch(() => {});
}

async function account() {
  const Role = require('../src/database/models/Role');
  await pool.query(
    "INSERT INTO roles (name, label, is_system) VALUES ('zz-name-planner','zz-name-planner',FALSE) ON CONFLICT (name) DO NOTHING");
  await Role.setPermissions('zz-name-planner', ['production.view', 'production.manage']);
  Role.invalidateCache();

  const id = 'local:zz-name-planner';
  users.push(id);
  await pool.query(
    `INSERT INTO users (user_id, email, display_name, role, auth_provider, password_hash, is_active)
     VALUES ($1, 'zz-name@etilog.local', 'Planner', 'zz-name-planner', 'local', $2, TRUE)
     ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
    [id, await auth.hashPassword('TestHeslo12345')]
  );
  return (await auth.signIn('zz-name@etilog.local', 'TestHeslo12345')).token;
}

const describe = async (code) => (await pool.query(
  'SELECT description FROM products WHERE fg_number = $1', [code])).rows[0]?.description;

async function main() {
  await cleanup();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  const token = await account();

  const NAME = 'FG999001_00_GLT_test_nazov_z_ciselnika';
  await pool.query(
    `INSERT INTO sap_items (item_code, item_name, project_type, synced_at)
     VALUES ($1, $2, 'GLT', CURRENT_TIMESTAMP)`, [MIRRORED, NAME]);

  console.log('\n1. Projekt, ktorý je v zrkadle');
  const a = await call('POST', '/api/production/products', { token, body: { fgNumber: MIRRORED } });
  check('karta vznikne', a.status, 201);
  check('a názov sa doplnil sám', a.body.data?.description, NAME);
  check('a je aj v databáze', await describe(MIRRORED), NAME);

  console.log('\n2. Dokončený projekt, do SAPu sa teraz ísť nedá');
  const b = await call('POST', '/api/production/products', { token, body: { fgNumber: FINISHED } });
  // Toto je tá podstatná časť: nedostupný SAP nesmie zabrániť vzniku karty.
  check('karta vznikne aj tak', b.status, 201);
  check('popis zostane prázdny, nie chybový', b.body.data?.description, null);

  console.log('\n3. Názov poslaný v požiadavke');
  const c = await call('POST', '/api/production/products', {
    token, body: { fgNumber: TOLD, description: 'Názov od klienta' }
  });
  check('použije sa ten', c.body.data?.description, 'Názov od klienta');

  // SAP je pánom mena projektu. Keď ho tam niekto opraví, má sa to prejaviť aj
  // tu - inak by si plánovač čítal roky starý popis bez toho, aby to tušil.
  console.log('\n4. Meno zo SAPu vyhráva nad tým, čo máme odložené');
  await pool.query('INSERT INTO products (fg_number, description) VALUES ($1, $2)',
                   [KEPT, 'Starý popis spred premenovania']);
  await pool.query(
    `INSERT INTO sap_items (item_code, item_name, synced_at) VALUES ($1, $2, CURRENT_TIMESTAMP)`,
    [KEPT, 'FG999004_00_GLT_premenovany_v_SAPe']);

  const d = await call('POST', '/api/production/products', { token, body: { fgNumber: KEPT } });
  check('požiadavka prejde', d.status, 201);
  check('popis sa obnovil zo SAPu', await describe(KEPT), 'FG999004_00_GLT_premenovany_v_SAPe');

  // Toto je ten prípad, ktorý prvá oprava minula. Projekt sa raz založil
  // predtým, než sa názvy dopĺňali, takže položka v zozname už je - a má
  // prázdny popis. Výber ju musí doplniť, nie ju obísť ako „už známu".
  console.log('\n5. Položka, ktorá už existuje s prázdnym popisom');
  await pool.query('INSERT INTO products (fg_number, description) VALUES ($1, NULL)', [EMPTY]);
  await pool.query(
    `INSERT INTO sap_items (item_code, item_name, synced_at) VALUES ($1, $2, CURRENT_TIMESTAMP)`,
    [EMPTY, 'FG999005_00_KLT_doplneny_dodatocne']);
  check('pred tým je popis prázdny', await describe(EMPTY), null);

  const e = await call('POST', '/api/production/products', { token, body: { fgNumber: EMPTY } });
  check('požiadavka prejde', e.status, 201);
  check('popis sa doplnil', e.body.data?.description, 'FG999005_00_KLT_doplneny_dodatocne');
  check('a ostal uložený', await describe(EMPTY), 'FG999005_00_KLT_doplneny_dodatocne');

  // A to isté na druhú stranu, lebo „SAP vyhráva" sa ľahko zvrhne na „SAP
  // mlčí, tak zmažeme". Keď meno nevie povedať nikto, ostáva to, čo máme.
  console.log('\n6. Keď SAP meno nedá, starý popis zostáva');
  await pool.query('INSERT INTO products (fg_number, description) VALUES ($1, $2)',
                   [SILENT, 'Popis, o ktorý sa nesmie prísť']);
  const f = await call('POST', '/api/production/products', { token, body: { fgNumber: SILENT } });
  check('požiadavka prejde', f.status, 201);
  check('popis sa nevymazal', await describe(SILENT), 'Popis, o ktorý sa nesmie prísť');

  console.log('\n7. Čo sa ani nepokúsi založiť');
  check('kód, ktorý nie je FG, neprejde',
        (await call('POST', '/api/production/products', { token, body: { fgNumber: 'XYZ1' } })).status, 400);
  check('bez prihlásenia už vôbec nie',
        (await call('POST', '/api/production/products', { body: { fgNumber: MIRRORED } })).status, 401);

  server.close();
  await liveReadFromSap();
}

/**
 * Živé čítanie názvu zo SAPu.
 *
 * Toto je tá cesta, na ktorej dokončený projekt stojí: v zrkadle nie je, takže
 * názov môže prísť jedine zo SAPu. Vyššie sa skúšala len s vypnutým SAPom,
 * kde správne nevráti nič - čo by rovnako dobre prešlo aj vtedy, keby čítanie
 * nefungovalo vôbec.
 *
 * Beží to proti vlastnému TLS serveru na localhoste a v samostatnom procese:
 * klient si nastavenie SAPu prečíta raz pri načítaní modulu, takže inak sa v
 * jednom behu zapnutý a vypnutý SAP vyskúšať nedajú. Do skutočného SAPu sa
 * nesiaha.
 */
async function liveReadFromSap() {
  const { execFileSync, spawn } = require('child_process');
  const crypto = require('crypto');
  const fs = require('fs');
  const https = require('https');
  const os = require('os');
  const path = require('path');

  console.log('\n8. Názov prečítaný priamo zo SAPu');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sap-name-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
      '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  } catch {
    console.log('  (preskočené - openssl nie je k dispozícii)');
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }

  const cert = fs.readFileSync(path.join(dir, 'cert.pem'));
  const key = fs.readFileSync(path.join(dir, 'key.pem'));
  const fingerprint = new crypto.X509Certificate(cert).fingerprint256;
  const NAME = 'FG999002_00_GLT_dokonceny_projekt';

  let asked = null;
  const sap = https.createServer({ cert, key }, (req, res) => {
    req.resume();
    if (req.url.endsWith('/Login')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': ['B1SESSION=x; path=/'] });
      return res.end(JSON.stringify({ SessionId: 'x' }));
    }
    asked = decodeURIComponent(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ItemCode: FINISHED, ItemName: NAME }));
  });

  await new Promise((resolve) => sap.listen(0, '127.0.0.1', resolve));
  const sapPort = sap.address().port;

  // `spawn`, nie `spawnSync`: server beží v tomto procese a synchrónny variant
  // by zablokoval jeho slučku udalostí.
  const child = spawn(process.execPath, ['-e', `
    const SapSyncService = require('${path.join(__dirname, '..', 'src', 'services', 'sapSyncService')}');
    SapSyncService.shared().itemName('${FINISHED}')
      .then((name) => { console.log('NAZOV:' + name); process.exit(0); },
            (error) => { console.log('CHYBA:' + error.message); process.exit(0); });
  `], {
    env: {
      ...process.env,
      SAP_ENABLED: 'true', SAP_HOST: '127.0.0.1', SAP_PORT: String(sapPort),
      SAP_DB: 'TESTDB', SAP_USER: 'test', SAP_PASSWORD: 'test',
      SAP_FINGERPRINT: fingerprint, SAP_VERIFY_TLS: 'false', LOG_LEVEL: 'error'
    },
    timeout: 20000
  });

  const output = await new Promise((resolve) => {
    let text = '';
    child.stdout.on('data', (chunk) => { text += chunk; });
    child.stderr.on('data', (chunk) => { text += chunk; });
    child.on('close', () => resolve(text));
  });

  check('názov sa prečíta zo SAPu', output.includes(`NAZOV:${NAME}`), true);
  check('a pýtal sa naň presne', (asked || '').includes(`Items('${FINISHED}')`), true);
  check('a nič iné nechcel', (asked || '').includes('$select=ItemCode,ItemName'), true);

  sap.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

main()
  .catch((error) => { console.error(error); failures += 1; })
  .then(async () => {
    await cleanup().catch(() => {});
    await pool.end().catch(() => {});
    console.log('');
    console.log(failures
      ? `${RED}${failures} kontrol zlyhalo${OFF}\n`
      : `${GREEN}Všetko prešlo${OFF} - názov sa doplní a bez SAPu karta vznikne aj tak.\n`);
    process.exit(failures ? 1 : 0);
  });
