#!/usr/bin/env node
/**
 * Dohľad nad stavom - `/health/status`.
 *
 *   node scripts/test-health-status.js
 *
 * Túto adresu sleduje služba mimo servera a podľa nej posiela upozornenia.
 * Ak sa pokazí ticho - vráti 200, keď je zle - nedozvie sa o tom nikto, lebo
 * jediný jej čitateľ je stroj. Preto sa každý poplach skúša naostro.
 *
 * Skript píše do `warehouse_sync_log` a po sebe upratuje. Proti inému než
 * lokálnemu serveru sa odmietne spustiť.
 */

require('dotenv').config();

const dbHost = process.env.DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1'].includes(dbHost) && process.env.ALLOW_REMOTE_DB !== 'yes') {
  console.error(`\nOdmietam bežať proti ${dbHost}. Toto je test, nie nástroj na produkčné dáta.\n`);
  process.exit(1);
}

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const OFF = '\x1b[0m';

process.env.MICROSOFT_APP_ID ||= '00000000-0000-0000-0000-000000000000';
process.env.MICROSOFT_APP_PASSWORD ||= 't';
process.env.TENANT_ID ||= process.env.MICROSOFT_APP_ID;
process.env.CLIENT_ID ||= process.env.MICROSOFT_APP_ID;
process.env.LOG_LEVEL = 'error';
process.env.HEALTH_CHECK_KEY = 'test-' + require('crypto').randomBytes(8).toString('hex');
// Disk tohto stroja s testom nesúvisí - nech je akokoľvek plný, kontrola disku
// má mlčať, aby sa dali overiť ostatné. Že zvoní, keď má, dokazuje bod 7.
process.env.HEALTH_DISK_MAX_PERCENT = '100';

const http = require('http');
const pool = require('../src/database/config');
const app = require('../src/index');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok
    ? `  ${GREEN}OK${OFF}   ${label}`
    : `  ${RED}FAIL${OFF} ${label} - čakalo ${JSON.stringify(expected)}, prišlo ${JSON.stringify(actual)}`);
  if (!ok) failures += 1;
};

let port;
const get = (path) => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port, path }, (res) => {
    let raw = ''; res.on('data', c => raw += c);
    res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                          catch { resolve({ status: res.statusCode, body: raw }); } });
  });
});

async function main() {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;

  console.log('\n1. Bez kľúča sa adresa tvári, že neexistuje');
  check('bez kľúča', (await get('/health/status')).status, 404);
  check('so zlým kľúčom', (await get('/health/status?key=zly')).status, 404);
  check('s kľúčom o znak dlhším', (await get('/health/status?key=' + process.env.HEALTH_CHECK_KEY + 'X')).status, 404);

  console.log('\n2. Obyčajný /health zostáva hlúpy a rýchly');
  const live = await get('/health');
  check('stále 200', live.status, 200);
  check('a netvrdí nič o systéme', live.body.status, 'healthy');

  console.log('\n3. So správnym kľúčom hlási stav');
  // Synchronizácia so SAPom v tejto databáze nikdy nebežala, takže má hlásiť
  // poplach - a to je presne to, čo chceme overiť.
  const bad = await get(`/health/status?key=${process.env.HEALTH_CHECK_KEY}`);
  check('vracia 503, keď je niečo zle', bad.status, 503);
  check('a hovorí čo', bad.body.failing, ['sapSync']);
  check('zhrnutie je veta pre človeka', bad.body.summary.includes('SAPom'), true);
  check('databáza je v poriadku', bad.body.checks.database.ok, true);
  check('disk sa zmeral', bad.body.checks.disk.disks.length > 0, true);

  console.log('\n4. Keď synchronizácia prebehla, je ticho');
  await pool.query(
    `INSERT INTO warehouse_sync_log (warehouse, codes, matched, ok, started_at, finished_at)
     VALUES ('02-03', 10, 10, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
  const good = await get(`/health/status?key=${process.env.HEALTH_CHECK_KEY}`);
  check('vracia 200', good.status, 200);
  check('zhrnutie je pokojné', good.body.summary, 'Všetko v poriadku');
  check('nič nezlyháva', good.body.failing, []);

  console.log('\n5. Zlyhaná synchronizácia je poplach');
  await pool.query(
    `INSERT INTO warehouse_sync_log (warehouse, codes, matched, ok, error, started_at, finished_at)
     VALUES ('02-03', 10, 0, FALSE, 'SAP neodpovedal', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
  const failed = await get(`/health/status?key=${process.env.HEALTH_CHECK_KEY}`);
  check('vracia 503', failed.status, 503);
  check('a cituje dôvod zo SAPu', failed.body.summary.includes('SAP neodpovedal'), true);

  console.log('\n6. Stará synchronizácia je tiež poplach');
  await pool.query('DELETE FROM warehouse_sync_log');
  await pool.query(
    `INSERT INTO warehouse_sync_log (warehouse, codes, matched, ok, started_at, finished_at)
     VALUES ('02-03', 10, 10, TRUE, CURRENT_TIMESTAMP - INTERVAL '30 hours', CURRENT_TIMESTAMP - INTERVAL '30 hours')`);
  const stale = await get(`/health/status?key=${process.env.HEALTH_CHECK_KEY}`);
  check('vracia 503', stale.status, 503);
  check('a povie, koľko hodín', stale.body.summary.includes('nebežala'), true);

  console.log('\n7. Prísnejší limit na disk zvoní');
  process.env.HEALTH_DISK_MAX_PERCENT = '1';
  delete require.cache[require.resolve('../src/services/healthService')];
  const health = require('../src/services/healthService');
  const report = await health.check();
  check('disk hlási problém', report.failing.includes('disk'), true);
  check('a napíše percentá aj voľné miesto', /\d+ %.*voľné/.test(report.summary), true);

  await pool.query('DELETE FROM warehouse_sync_log');
  server.close();
}

main().catch(e => { console.error(e); failures += 1; })
  .finally(async () => {
    await pool.end().catch(() => {});
    console.log(failures
      ? `\n${RED}${failures} kontrol zlyhalo${OFF}\n`
      : `\n${GREEN}Všetko prešlo${OFF} - poplach zvoní, keď má, a mlčí, keď nemá.\n`);
    setTimeout(() => process.exit(failures ? 1 : 0), 200);
  });
