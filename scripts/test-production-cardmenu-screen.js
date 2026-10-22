#!/usr/bin/env node
/**
 * Pravé tlačidlo na karte: je tam Duplicate a robí to, čo má?
 *
 *   npm run build:production && node scripts/test-production-cardmenu-screen.js
 *
 * Položka v ponuke je jeden riadok JSX a obsluha k nej je inde. Keď sa tie dve
 * veci nestretnú - preklep v názve, zabudnuté odovzdanie z App.jsx - ponuka sa
 * vykreslí úplne normálne a spadne až v okamihu, keď na ňu plánovač klikne.
 * Server o tom nevie, build prejde, a vidno to len tak, že sa na ňu klikne.
 *
 * Tak sa na ňu tu klikne: skutočný prehliadač, zostavený balík, a kontroluje
 * sa, že z toho kliknutia naozaj odíde požiadavka na duplikovanie tej karty,
 * na ktorú sa klikalo.
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
    if (!path.extname(file)) file = path.join(file, 'index.html');
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
}

const json = (data, extra = {}) => ({ status: 200, contentType: 'application/json',
                                      body: JSON.stringify({ data, ...extra }) });

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 86400 })}.x`;

const ME = { id: 'u1', email: 'admin@etilog.sk', name: 'Admin',
             permissions: ['production.view', 'production.manage'], accessControlMode: 'enforce' };

const LOCATION = { id: 1, code: 'PO1', name: 'PO1', is_internal: true, is_active: true };
const SHIFTS = [{ id: 11, name: 'Morning', sort_order: 10 }, { id: 12, name: 'Afternoon', sort_order: 20 }];

/** Pondelok tohto týždňa - karta musí sedieť v okne, ktoré plán práve kreslí. */
function monday() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  now.setDate(now.getDate() - day);
  return now.toISOString().slice(0, 10);
}

const CARD = {
  id: 501, location_id: 1, production_date: monday(), shift_id: 11,
  custom_product_name: 'TESLA ABD', fg_number: null, planned_quantity: 240,
  priority: 'normal', status: 'planned', color: null, notes: null, sort_order: 0, version: 1
};

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'production', 'index.html'))) {
    console.error('\nChýba public/production - najprv `npm run build:production`.\n');
    process.exit(1);
  }

  const server = serve(ROOT);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const context = await browser.newContext();
  await context.addInitScript((token) => localStorage.setItem('etilog_token', token), TOKEN);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // Čo odišlo na server - na tom celý test stojí.
  const duplicated = [];

  await page.route('**/api/**', (route) => route.fulfill(json([])));
  await page.route('**/api/admin/me', (route) => route.fulfill(json(ME)));
  await page.route('**/api/production/locations', (route) => route.fulfill(json([LOCATION])));
  await page.route('**/api/production/plan**', (route) => route.fulfill(json({
    location: LOCATION, shifts: SHIFTS, entries: [CARD],
    dayFlags: [], shiftNotes: [], exceptions: []
  })));
  await page.route('**/api/production/entries/*/duplicate', (route) => {
    duplicated.push(route.request().url());
    return route.fulfill(json({ ...CARD, id: 777 }, { undo: { deleteIds: [777] } }));
  });

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${base}/production/`);
  await page.waitForSelector('.week-grid', { timeout: 15000 });
  await page.waitForTimeout(600);

  console.log('\n1. Ponuka sa otvorí nad kartou');
  const card = page.getByText('TESLA ABD').first();
  check('karta je na pláne', await card.count(), 1);

  await card.click({ button: 'right' });
  await page.waitForSelector('[role="menu"]', { timeout: 5000 });
  await page.waitForTimeout(250);

  const items = await page.locator('[role="menu"] [role="menuitem"]').allInnerTexts();
  check('Duplicate je v ponuke', items.includes('Duplicate'), true);
  check('a stále sú tam aj ostatné',
        ['Mark as Done', 'Edit…', 'Delete'].every((label) => items.includes(label)), true);

  console.log('\n2. Kliknutie naozaj duplikuje');
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  await page.waitForTimeout(800);

  check('odišla práve jedna požiadavka', duplicated.length, 1);
  // Práve toto odhalí zle odovzdanú kartu: ponuka by sa otvorila, kliknutie by
  // prešlo, a duplikovala by sa iná karta, než na ktorú sa klikalo.
  check('a to pre tú kartu, na ktorú sa klikalo',
        duplicated[0]?.endsWith('/api/production/entries/501/duplicate'), true);
  check('ponuka sa zavrela', await page.locator('[role="menu"]').count(), 0);

  console.log('\n3. Nič nespadlo');
  check('žiadna chyba na stránke', errors, []);

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
      : `${GREEN}Všetko prešlo${OFF} - Duplicate je v ponuke a je zapojené.\n`);
    process.exit(failures ? 1 : 0);
  });
