#!/usr/bin/env node
/**
 * Do mzdového exportu patria len ľudia s osobným číslom.
 *
 *   node scripts/test-export-personal-number.js
 *
 * Kolegyňa ten export odovzdáva do PAM. Riadok človeka, ktorý v PAM nie je,
 * sa nemá ako spárovať - je to práca navyše a zdroj omylov. Týka sa to aj
 * tých, ktorí externí zaškrtnuté nemajú, len im číslo ešte nikto nedoplnil.
 *
 * Dve veci sa tu dajú ľahko pokaziť a obe sú tu odskúšané:
 *
 *   Vyhodiť priveľa. Nákup ani výdavok sa s PAM nepárujú, takže sa z
 *   exportu vyhadzovať nesmú - inak by zmizli žiadosti, ktoré s mzdami
 *   nemajú nič spoločné.
 *
 *   Vyhodiť potichu. Kratší súbor vyzerá rovnako ako úplný. Preto odpoveď
 *   nesie počet vynechaných, nech má klient čo povedať.
 *
 * Skript si vyrobí vlastných používateľov aj žiadosti a po sebe ich zmaže.
 * Proti inému než lokálnemu serveru sa odmietne spustiť.
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
process.env.TENANT_ID ||= process.env.MICROSOFT_APP_ID;
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
  console.log(ok
    ? `  ${GREEN}OK${OFF}   ${label}`
    : `  ${RED}FAIL${OFF} ${label} - čakalo ${JSON.stringify(expected)}, prišlo ${JSON.stringify(actual)}`);
  if (!ok) failures += 1;
};

let port;
function call(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET',
                               headers: { Authorization: `Bearer ${token}` } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        skipped: Number(res.headers['x-export-skipped'] ?? -1),
        buffer: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

const ROLE = 'zz-exp-hr';
const S_CISLOM = 'zz-exp-s-cislom';
const BEZ_CISLA = 'zz-exp-bez-cisla';
const EXTERNY = 'zz-exp-externy';
const USERS = [`local:${ROLE}`, S_CISLOM, BEZ_CISLA, EXTERNY];
const YEAR = new Date().getFullYear();
const OD = `${YEAR}-03-01`;
const DO = `${YEAR}-03-31`;

async function cleanup() {
  await pool.query("DELETE FROM tickets WHERE ticket_id LIKE 'ZZ-EXP-%'");
  await pool.query('DELETE FROM employee_quotas WHERE user_id = ANY($1)', [USERS]);
  await pool.query('DELETE FROM users WHERE user_id = ANY($1)', [USERS]);
  await pool.query('DELETE FROM roles WHERE name = $1', [ROLE]).catch(() => {});
}

const ziadost = (id, userId, meno, typ) => pool.query(
  `INSERT INTO tickets (ticket_id, title, description, ticket_type, status,
                        created_by_id, created_by_name, created_by_email,
                        start_date, end_date)
   VALUES ($1, 'test', 'test', $2, 'Approved', $3, $4, 'zz@etilog.local', $5, $5)`,
  [id, typ, userId, meno, `${YEAR}-03-10`]
);

/** Mená, ktoré v exporte naozaj sú - čítané zo zošita. */
function namesInSheet(buffer) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  return rows.map((r) => r['Zamestnanec'] ?? r['Employee']).sort();
}

async function main() {
  await cleanup();

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;

  const Role = require('../src/database/models/Role');
  await pool.query('INSERT INTO roles (name, label, is_system) VALUES ($1,$1,FALSE) ON CONFLICT (name) DO NOTHING', [ROLE]);
  await Role.setPermissions(ROLE, ['hr.manage']);
  Role.invalidateCache();
  await pool.query(
    `INSERT INTO users (user_id, email, display_name, role, auth_provider, password_hash, is_active)
     VALUES ($1,$2,$3,$4,'local',$5,TRUE)`,
    [`local:${ROLE}`, 'zz-exp-hr@etilog.local', ROLE, ROLE, await auth.hashPassword('TestHeslo12345')]
  );
  const token = (await auth.signIn('zz-exp-hr@etilog.local', 'TestHeslo12345')).token;

  for (const [id, meno, cislo, externy] of [
    [S_CISLOM, 'Anna S Cislom', 9101, false],
    [BEZ_CISLA, 'Boris Bez Cisla', null, false],
    [EXTERNY, 'Cyril Externy', null, true]
  ]) {
    await pool.query(
      `INSERT INTO users (user_id, email, display_name, role, auth_provider, is_active,
                          personal_number, is_external)
       VALUES ($1, $2, $3, 'user', 'azure', TRUE, $4, $5)`,
      [id, `${id}@etilog.local`, meno, cislo, externy]
    );
  }

  await ziadost('ZZ-EXP-1', S_CISLOM, 'Anna S Cislom', 'vacation');
  await ziadost('ZZ-EXP-2', BEZ_CISLA, 'Boris Bez Cisla', 'vacation');
  await ziadost('ZZ-EXP-3', EXTERNY, 'Cyril Externy', 'paragraph');
  await ziadost('ZZ-EXP-4', BEZ_CISLA, 'Boris Bez Cisla', 'ocr');
  // Nákup sa s PAM nepáruje - v exporte musí zostať aj od človeka bez čísla.
  await ziadost('ZZ-EXP-5', BEZ_CISLA, 'Boris Bez Cisla', 'purchase');

  const url = (extra = '') =>
    `/api/admin/export/tickets?dateFrom=${OD}&dateTo=${DO}&statuses=Approved&format=xlsx&lang=sk${extra}`;

  console.log('\n1. Mzdové typy: len ľudia s osobným číslom');
  let res = await call(url('&type=vacation'), token);
  check('export prejde', res.status, 200);
  check('je tam len Anna', namesInSheet(res.buffer), ['Anna S Cislom']);
  check('a povie, koľkých vynechal', res.skipped, 1);

  console.log('\n2. Externý sa tiež nevyváža');
  // Externý v PAM nie je o nič viac než ten, komu číslo len chýba - a
  // pravidlo je jedno: bez osobného čísla do mzdového exportu nepatrí.
  res = await call(url('&type=paragraph'), token);
  check('nič na export', res.status, 404);
  check('a vie prečo', res.skipped, 1);
  const telo = JSON.parse(res.buffer.toString());
  check('povie to aj vetou', telo.message.includes('bez osobného čísla'), true);

  console.log('\n3. Nemzdové typy zostávajú nedotknuté');
  res = await call(url('&type=purchase'), token);
  check('nákup sa vyvezie', res.status, 200);
  check('aj od človeka bez čísla', namesInSheet(res.buffer), ['Boris Bez Cisla']);
  check('nikoho nevynechal', res.skipped, 0);

  console.log('\n4. Export bez výberu typu');
  res = await call(url(), token);
  check('prejde', res.status, 200);
  // Dovolenka a sprievod Borisa aj paragraf Cyrila von, nákup zostáva.
  check('mzdové bez čísla sú preč, nákup zostal',
        namesInSheet(res.buffer), ['Anna S Cislom', 'Boris Bez Cisla']);
  check('vynechané tri', res.skipped, 3);

  console.log('\n5. Export pre jedného zamestnanca');
  // Filter dovtedy mieril na stĺpec created_by, ktorý v tabuľke neexistuje,
  // takže toto končilo chybou 500.
  res = await call(url(`&employee=${encodeURIComponent(S_CISLOM)}`), token);
  check('nepadne', res.status, 200);
  check('a vráti naozaj len jeho', namesInSheet(res.buffer), ['Anna S Cislom']);

  console.log('\n6. Kto sa k exportu vôbec dostane');
  check('bez prihlásenia nie',
        (await new Promise((resolve) => {
          http.get({ host: '127.0.0.1', port, path: url() }, (r) => resolve({ status: r.statusCode }));
        })).status, 401);

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
      : `${GREEN}Všetko prešlo${OFF} - do miezd idú len ľudia s osobným číslom, nákup zostal.\n`);
    process.exit(failures ? 1 : 0);
  });
