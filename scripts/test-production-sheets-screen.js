#!/usr/bin/env node
/**
 * Výrobný plán: hárok s jednou smenou a obrazovka na správu hárkov.
 *
 *   npm run build:production && node scripts/test-production-sheets-screen.js
 *
 * Jednosmenný hárok má mať deň ako jedno pole - bez stĺpca s názvom smeny,
 * bez ikonky, bez farebného prúžku. To je presne ten druh zmeny, ktorú server
 * nikdy neuvidí: odpovie rovnakými dátami a rozdiel je len v tom, čo sa z nich
 * nakreslí. Preto sa tu spúšťa skutočný prehliadač nad skutočným zostaveným
 * balíkom a odpovede sa podstrkujú.
 *
 * Najcennejšia je tu tá kontrola počtu stĺpcov. Keby sa stĺpec s názvom smeny
 * prestal kresliť, ale mriežka by si ho ďalej rezervovala, každá bunka by sa
 * posunula o deň vedľa - pondelková práca by sedela pod utorkom. Na obrázku to
 * vyzerá úplne v poriadku a všimne si to až niekto v hale.
 *
 * Beží nad `public/production`, teda nad tým, čo sa naozaj nasadzuje.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('\nPlaywright nie je nainštalovaný (npm install), tento test sa bez neho nespustí.\n');
  process.exit(1);
}

const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const ROOT = path.join(__dirname, '..', 'public');
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const OFF = '\x1b[0m';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? `${GREEN}OK${OFF}  ` : `${RED}FAIL${OFF}`} ${label}` +
              (ok ? '' : `  čakalo ${JSON.stringify(expected)}, prišlo ${JSON.stringify(actual)}`));
  if (!ok) failures += 1;
}

function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                  '.svg': 'image/svg+xml', '.png': 'image/png' };
  return http.createServer((req, res) => {
    let file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    // The real server hands back the SPA shell for /production/ and for any
    // path under it; without that the app never loads and nothing below here
    // means anything.
    if (!path.extname(file)) file = path.join(file, 'index.html');

    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
}

const json = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 86400 })}.x`;

const ME = {
  id: 'u1', email: 'admin@etilog.sk', name: 'Admin',
  permissions: ['production.view', 'production.manage'],
  accessControlMode: 'enforce'
};

const SHEETS = [
  { id: 1, code: 'DVE', name: 'Dvojsmenná', is_internal: true, is_active: true, sort_order: 10,
    shift_count: 2, shift_mode: 'double' },
  { id: 2, code: 'JEDNA', name: 'Jednosmenná', is_internal: true, is_active: true, sort_order: 20,
    shift_count: 1, shift_mode: 'single' }
];

const LOCATIONS = SHEETS.map(({ id, code, name, is_internal, is_active }) =>
  ({ id, code, name, is_internal, is_active }));

/** The plan response, with as many shifts as the sheet has. */
function planFor(code) {
  const location = LOCATIONS.find((l) => l.code === code) || LOCATIONS[0];
  const shifts = code === 'JEDNA'
    ? [{ id: 11, name: 'Morning', sort_order: 10 }]
    : [{ id: 21, name: 'Morning', sort_order: 10 }, { id: 22, name: 'Afternoon', sort_order: 20 }];

  return { location, shifts, entries: [], dayFlags: [], shiftNotes: [], exceptions: [] };
}

async function openPlan(browser, base, code) {
  const context = await browser.newContext();
  await context.addInitScript((token) => localStorage.setItem('etilog_token', token), TOKEN);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // Posledná zaregistrovaná obsluha vyhráva, takže od najvšeobecnejšej po
  // najkonkrétnejšiu - inak by `**/api/**` pohltilo všetko ostatné.
  await page.route('**/api/**', (route) => route.fulfill(json([])));
  await page.route('**/api/admin/me', (route) => route.fulfill(json(ME)));
  await page.route('**/api/production/locations', (route) => route.fulfill(json(LOCATIONS)));
  await page.route('**/api/production/sheets', (route) => route.fulfill(json(SHEETS)));
  await page.route('**/api/production/plan**', (route) => {
    const asked = new URL(route.request().url()).searchParams.get('location');
    return route.fulfill(json(planFor(asked)));
  });

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/production/`);
  await page.waitForSelector('.week-grid', { timeout: 15000 });

  // Jeden týždeň na obrazovke. Predvolené sú štyri a potom je všetkého
  // štyrikrát toľko - počty nižšie by hovorili o rozložení mriežky čoraz menej.
  await page.getByRole('button', { name: '1w', exact: true }).click();
  await page.waitForTimeout(400);
  return { page, errors };
}

/** How many columns the grid is actually laid out in, as the browser computes it. */
const columnCount = (page) => page.evaluate(() =>
  getComputedStyle(document.querySelector('.week-grid')).gridTemplateColumns.split(' ').length);

/** The legend's own text. Named by its heading, so the selector cannot drift. */
const legendText = (page) => page.getByText('Legend', { exact: true }).locator('..').innerText();

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'production', 'index.html'))) {
    console.error('\nChýba public/production - najprv `npm run build:production`.\n');
    process.exit(1);
  }

  const server = serve(ROOT);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});

  // ------------------------------------------------------------ dve smeny
  console.log('\n1. Dvojsmenný hárok vyzerá ako doteraz');
  let { page, errors } = await openPlan(browser, base, 'DVE');

  check('deň a smena majú svoj stĺpec', await page.locator('.corner-sticky').count(), 1);
  // Veľkými písmenami, lebo tak ich kreslí mriežka - `allInnerTexts` vracia
  // text tak, ako ho vidno, nie ako je v zdroji.
  check('a sú tam obe smeny',
        await page.locator('.week-grid .row-label:not(.corner-sticky)').allInnerTexts(),
        ['MORNING', 'AFTERNOON']);
  check('mriežka má stĺpec na popisky plus sedem dní', await columnCount(page), 8);
  check('legenda smeny vymenúva', (await legendText(page)).includes('Morning'), true);
  await page.close();

  // ----------------------------------------------------------- jedna smena
  console.log('\n2. Jednosmenný hárok je jedno pole na deň');
  ({ page, errors } = await openPlan(browser, base, 'DVE'));
  await page.getByRole('tab', { name: 'Jednosmenná' }).click();
  await page.waitForTimeout(600);

  check('stĺpec na popisky zmizol', await page.locator('.corner-sticky').count(), 0);
  check('názov smeny sa nikde nekreslí',
        await page.locator('.week-grid .row-label').count(), 0);
  check('mriežka má presne sedem stĺpcov', await columnCount(page), 7);
  check('dní je sedem', await page.locator('.week-grid .day-sticky').count(), 7);
  check('legenda už smeny nevymenúva', (await legendText(page)).includes('Morning'), false);
  check('a ostatné značky v nej zostali', (await legendText(page)).includes('Urgent'), true);
  await page.close();

  // -------------------------------------------------------- správa hárkov
  console.log('\n3. Správa hárkov');
  ({ page, errors } = await openPlan(browser, base, 'DVE'));
  await page.getByRole('button', { name: 'Manage sheets' }).click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.waitForTimeout(400);

  const dialog = page.locator('[role="dialog"]');
  check('obidva hárky sú v zozname',
        (await dialog.locator('li').count()), 2);
  check('každý má prepínač smien',
        await dialog.locator('[role="radiogroup"]').count(), 2);
  check('dvojsmenný má zvolené dve smeny',
        await dialog.locator('li').first().getByRole('radio', { name: 'Two shifts' })
          .getAttribute('aria-checked'), 'true');
  check('jednosmenný má zvolenú jednu',
        await dialog.locator('li').last().getByRole('radio', { name: 'One shift' })
          .getAttribute('aria-checked'), 'true');
  check('prvý sa nedá posunúť vyššie',
        await dialog.locator('li').first().getByRole('button', { name: /earlier/ }).isDisabled(), true);

  // Mazanie: tlačidlo neotvára nič, čo by mazalo samo - najprv musí prísť
  // názov hárku, a kým nesedí, potvrdenie je nedostupné.
  await dialog.locator('li').first().getByRole('button', { name: 'Delete Dvojsmenná' }).click();
  await page.waitForTimeout(300);
  const confirmButton = dialog.getByRole('button', { name: 'Delete sheet' });
  check('potvrdenie je zatiaľ nedostupné', await confirmButton.isDisabled(), true);

  await dialog.locator('input').last().fill('Dvojsmen');
  check('pri nedopísanom názve stále nedostupné', await confirmButton.isDisabled(), true);

  await dialog.locator('input').last().fill('Dvojsmenná');
  check('až so správnym názvom je dostupné', await confirmButton.isDisabled(), false);

  check('nič nespadlo', errors, []);
  await page.close();

  await browser.close();
  server.close();
}

main()
  .catch((error) => { console.error(error); failures += 1; })
  .then(() => {
    console.log('');
    console.log(failures
      ? `${RED}${failures} kontrol zlyhalo${OFF}\n`
      : `${GREEN}Všetko prešlo${OFF} - jedna smena je jedno pole a hárky sa dajú spravovať.\n`);
    process.exit(failures ? 1 : 0);
  });
