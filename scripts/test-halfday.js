#!/usr/bin/env node
/**
 * Pol dňa musí byť vidieť na prvý pohľad.
 *
 *   node scripts/test-halfday.js
 *
 * Kto sa pozrie na nástenku alebo do tímového kalendára, pýta sa „môžem s
 * ním dnes rátať?". Pri polovičnej dovolenke je odpoveď áno, len pol dňa -
 * a bez štítku to vyzerá rovnako ako celodenná neprítomnosť.
 *
 * Najdôležitejšia je tu tá podmienka jedného dňa. Príznak is_half_day sedí
 * na žiadosti aj vtedy, keď niekto zaškrtne polovičný deň a potom natiahne
 * dátumy na týždeň - ticketService ho v takom prípade ignoruje a odpočíta
 * celý týždeň. Keby kalendár štítok ukázal aj tam, tvrdil by o týždni
 * dovolenky, že je to pol dňa.
 *
 * Prvá časť skúša server naostro proti databáze, druhá obrazovky v
 * prehliadači. Proti inému než lokálnemu serveru sa odmietne spustiť.
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

const http = require('http');
const fs = require('fs');
const path = require('path');
const pool = require('../src/database/config');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  console.error('\nPlaywright nie je nainštalovaný (npm install), tento test sa bez neho nespustí.\n');
  process.exit(1);
}

const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const PUBLIC = path.join(__dirname, '..', 'public');
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

const TODAY = new Date().toISOString().slice(0, 10);
const IDS = ['ZZ-HALF-1', 'ZZ-HALF-2', 'ZZ-HALF-3'];

const cleanup = () => pool.query('DELETE FROM tickets WHERE ticket_id = ANY($1)', [IDS]);

const ziadost = (id, meno, od, doDna, halfDay) => pool.query(
  `INSERT INTO tickets (ticket_id, title, description, ticket_type, status,
                        created_by_id, created_by_name, created_by_email,
                        start_date, end_date, is_half_day)
   VALUES ($1, 'test', 'test', 'vacation', 'Approved', $2, $3, 'zz@etilog.local', $4, $5, $6)`,
  [id, `zz-${id}`, meno, od, doDna, halfDay]
);

function serveStatic(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                  '.svg': 'image/svg+xml', '.png': 'image/png' };
  return http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
}

const json = (data) => ({ status: 200, contentType: 'application/json',
                          body: JSON.stringify({ success: true, data }) });

/**
 * Obe stránky sa pri štarte pýtajú Teams SDK, či beží v Teamse, a to SDK sa
 * ťahá z CDN. V teste tam nie je ani jedno, tak sa podstrčí: SDK sa z CDN
 * nepustí vôbec a `initialize()` len hneď skončí. Predmetom skúšky je to,
 * čo stránka nakreslí, nie prihlásenie do Teamsu.
 */
async function teamsContext(browser, lang = 'sk') {
  const ctx = await browser.newContext();
  await ctx.route('**res.cdn.office.net/**', (r) => r.abort());
  await ctx.addInitScript((l) => {
    localStorage.setItem('appLanguage', l);
    window.microsoftTeams = {
      app: { initialize: async () => {}, getContext: async () => ({ user: { id: 'zz' } }) }
    };
  }, lang);
  return ctx;
}

async function main() {
  await cleanup();

  // Tri dnešné neprítomnosti: polovičná, celodenná, a viacdňová so
  // zaškrtnutým polovičným dňom (ktorý sa má ignorovať).
  const zajtra = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  await ziadost('ZZ-HALF-1', 'Anna Polovicna', TODAY, TODAY, true);
  await ziadost('ZZ-HALF-2', 'Boris Celodenny', TODAY, TODAY, false);
  await ziadost('ZZ-HALF-3', 'Cyril Tyzdenny', TODAY, zajtra, true);

  // ------------------------------------------------------------- server

  console.log('\n1. Server hovorí, kto má pol dňa');
  const app = require('../src/index');
  const api = http.createServer(app);
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const apiPort = api.address().port;

  const odpoved = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: apiPort,
               path: `/api/teams/dashboard/out-of-office?date=${TODAY}` }, (res) => {
      let raw = ''; res.on('data', (c) => { raw += c; });
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });

  const podlaMena = Object.fromEntries(
    (odpoved.data?.employees || [])
      .filter((e) => String(e.userId).startsWith('zz-ZZ-HALF'))
      .map((e) => [e.userId, e.absences[0]])
  );
  check('vrátil všetkých troch', Object.keys(podlaMena).length, 3);
  check('polovičná je označená', podlaMena['zz-ZZ-HALF-1']?.halfDay, true);
  check('celodenná nie je', podlaMena['zz-ZZ-HALF-2']?.halfDay, false);
  // Jadro testu: príznak na viacdňovej žiadosti sa ignoruje, rovnako ako
  // ho ignoruje odpočet kvóty.
  check('viacdňová so zaškrtnutým pol dňom tiež nie', podlaMena['zz-ZZ-HALF-3']?.halfDay, false);

  api.close();

  // ---------------------------------------------------------- obrazovky

  const stat = serveStatic(PUBLIC);
  await new Promise((r) => stat.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${stat.address().port}`;
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  const EMPLOYEES = [
    { userId: 'a', name: 'Anna Polovicna', absences: [{ ticketId: 'ZZ-HALF-1', type: 'vacation',
        startDate: TODAY, endDate: TODAY, title: 'test', halfDay: true }] },
    { userId: 'b', name: 'Boris Celodenny', absences: [{ ticketId: 'ZZ-HALF-2', type: 'vacation',
        startDate: TODAY, endDate: TODAY, title: 'test', halfDay: false }] }
  ];

  console.log('\n2. Nástenka v Teamse - Dnes mimo kancelárie');
  let ctx = await teamsContext(browser);
  let page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`dashboard: ${e.message}`));
  // Všeobecné pravidlo prvé, konkrétne druhé: Playwright berie to naposledy
  // zaregistrované, takže inak by catch-all prehlušil odpoveď nižšie.
  await page.route('**/api/**', (r) => r.fulfill(json([])));
  await page.route('**/out-of-office**', (r) => r.fulfill(json({ employees: EMPLOYEES })));
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${base}/pages/dashboard.html`);
  await page.waitForTimeout(900);
  await page.evaluate(() => loadOutOfOfficeData());
  await page.waitForTimeout(400);

  check('sú tam obaja ľudia', await page.locator('.ooo-person').count(), 2);
  check('štítok je práve jeden', await page.locator('.ooo-half-badge').count(), 1);
  check('a je pri tej správnej osobe',
        (await page.locator('.ooo-person', { hasText: 'Anna' }).innerText()).includes('Pol dňa'), true);
  check('celodennému nepribudol',
        (await page.locator('.ooo-person', { hasText: 'Boris' }).innerText()).includes('Pol dňa'), false);
  await page.close();

  console.log('\n3. Tímový kalendár');
  const TICKETS = [
    { ticket_id: 'ZZ-HALF-1', ticket_type: 'vacation', status: 'Approved',
      created_by_name: 'Anna Polovicna', start_date: TODAY, end_date: TODAY, is_half_day: true },
    { ticket_id: 'ZZ-HALF-2', ticket_type: 'vacation', status: 'Approved',
      created_by_name: 'Boris Celodenny', start_date: TODAY, end_date: TODAY, is_half_day: false },
    { ticket_id: 'ZZ-HALF-3', ticket_type: 'vacation', status: 'Approved',
      created_by_name: 'Cyril Tyzdenny', start_date: TODAY, end_date: zajtra, is_half_day: true },
    // Dlhé meno so štítkom vedľa - presne ten prípad, v ktorom sa karta
    // skracovala na „Dominik…".
    { ticket_id: 'ZZ-HALF-4', ticket_type: 'vacation', status: 'Approved',
      created_by_name: 'Dominik Hrabovský-Štefanovič', start_date: TODAY, end_date: TODAY, is_half_day: true }
  ];

  ctx = await teamsContext(browser);
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`kalendar: ${e.message}`));
  await page.route('**/api/**', (r) => r.fulfill(json([])));
  await page.route('**/api/tickets**', (r) => r.fulfill(json(TICKETS)));
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.goto(`${base}/pages/upcoming-time-off.html`);
  await page.waitForTimeout(1400);

  // Predvolený rozsah je dnešok, nie celý mesiac.
  check('predvolene je vybraný dnešok',
        await page.locator('.quick-filter-btn.active').innerText(), 'Dnes');
  check('a je to naozaj len jeden deň',
        [await page.inputValue('#dateFrom'), await page.inputValue('#dateTo')], [TODAY, TODAY]);

  check('štyria ľudia na dnešku', await page.locator('.person-card').count(), 4);
  check('štítky sú dva', await page.locator('.person-half-badge').count(), 2);
  check('pri polovičnej',
        (await page.locator('.person-card', { hasText: 'Anna' }).innerText()).includes('Pol dňa'), true);
  check('celodennej nie',
        (await page.locator('.person-card', { hasText: 'Boris' }).innerText()).includes('Pol dňa'), false);
  // To isté, čo stráži server, musí platiť aj na obrazovke - tá si tickety
  // ťahá zo všeobecného zoznamu, takže pravidlo si vyhodnocuje sama.
  check('viacdňovej so zaškrtnutým pol dňom tiež nie',
        (await page.locator('.person-card', { hasText: 'Cyril' }).innerText()).includes('Pol dňa'), false);

  console.log('\n4. Celé meno, aj keď je dlhé');
  // „Dominik…" je horšie než nič: kto sa pozerá do kalendára, chce vedieť,
  // s kým dnes rátať nemôže, a priezvisko je práve tá časť, ktorá odlišuje
  // dvoch Dominikov.
  const dlhe = page.locator('.person-card', { hasText: 'Dominik' }).locator('.person-name');
  check('meno je celé', (await dlhe.innerText()).trim(), 'Dominik Hrabovský-Štefanovič');
  check('a nie je orezané', await dlhe.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true);
  check('ani keď je vedľa štítok',
        (await page.locator('.person-card', { hasText: 'Dominik' }).innerText()).includes('Pol dňa'), true);

  console.log('\n5. Mesiac sa dá stále vybrať');
  await page.locator('.quick-filter-btn[data-range="month"]').click();
  await page.waitForTimeout(400);
  check('prepne sa', await page.locator('.quick-filter-btn.active').innerText(), 'Tento mesiac');
  check('a rozsah je celý mesiac', (await page.inputValue('#dateFrom')).slice(-2), '01');
  await page.close();

  check('nič nespadlo', errors, []);

  await browser.close();
  stat.close();
}

main()
  .catch((error) => { console.error(error); failures += 1; })
  .then(async () => {
    await cleanup().catch(() => {});
    await pool.end().catch(() => {});
    console.log('');
    console.log(failures
      ? `${RED}${failures} kontrol zlyhalo${OFF}\n`
      : `${GREEN}Všetko prešlo${OFF} - pol dňa je vidieť a týždeň sa zaň nevydáva.\n`);
    process.exit(failures ? 1 : 0);
  });
