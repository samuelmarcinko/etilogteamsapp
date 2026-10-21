#!/usr/bin/env node
/**
 * HR modul: paragraf - lekár a paragraf - sprievod.
 *
 *   node scripts/test-hr-paragraph-labels.js
 *
 * V systéme nie je ošetrenie člena rodiny. To, čo sa volalo OČR, je paragraf
 * na sprievod rodinného príslušníka - iný nárok a iný zákon - a zamestnanec to
 * meno nesmie uvidieť nikde.
 *
 * Dve veci sa tu skúšajú a každá inak:
 *
 *   Premenovanie prešlo cez dvadsať súborov v dvoch rozhraniach. Jedna
 *   zabudnutá obrazovka sa nijako neprejaví - server odpovie rovnako, nič
 *   nespadne, a v jednom menu zostane staré meno, kým si toho o mesiac
 *   niekto nevšimne. Preto sa súbory prehľadávajú na zakázané slová.
 *
 *   Zelený zostatok nad formulárom bol doteraz len pre dovolenku. Teraz má
 *   byť pri oboch paragrafoch, a tie sa míňajú v hodinách, nie v dňoch -
 *   osem na pracovný deň, rovnako ako to po odoslaní prepočíta server. Keby
 *   obrazovka ukazovala dni, zamestnanec by videl, že mu zostatok stačí, a
 *   server by žiadosť aj tak odmietol.
 *
 * Beží to nad skutočnými súbormi z `public/`; odpovede servera sa podstrkujú,
 * lebo predmetom skúšky je obrazovka.
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

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? `${GREEN}OK${OFF}  ` : `${RED}FAIL${OFF}`} ${label}` +
              (ok ? '' : `  čakalo ${JSON.stringify(expected)}, prišlo ${JSON.stringify(actual)}`));
  if (!ok) failures += 1;
}

// =========================================================================
// 1. Staré meno nesmie zostať nikde, kde ho uvidí človek
// =========================================================================

// Súbory, v ktorých sa text zobrazuje používateľovi. Migrácie sem nepatria -
// tie staré meno obsahovať musia, inak by sa nemalo čo prepísať.
const SCANNED = [
  'public/portal/assets/js/portal.js',
  'public/portal/assets/js/portalI18n.js',
  'public/portal/index.html',
  'public/assets/js/i18n.js',
  'public/assets/js/app.js',
  'public/assets/js/dashboard.js',
  'public/assets/js/navigation.js',
  'public/pages/sick-notes.html',
  'public/pages/dashboard.html',
  'public/pages/my-requests.html',
  'public/pages/approvals.html',
  'public/pages/upcoming-time-off.html',
  'src/services/ticketService.js',
  'src/controllers/adminController.js'
];

// Slová, ktoré sa na obrazovku nesmú dostať. `ocr` ako kľúč je v poriadku a
// zostáva - hľadá sa meno, nie identifikátor, takže vzory sú na slovo presné.
const FORBIDDEN = [
  ['OČR', 'staré slovenské meno'],
  ['Family Member Care', 'staré anglické meno'],
  ['Ošetrenie člena rodiny', 'rozpis starého mena'],
  ['Paragrafy & OČR', 'starý názov sekcie']
];

function scanFiles() {
  console.log('\n1. Staré meno nikde na obrazovke');

  const offenders = [];
  for (const file of SCANNED) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) { offenders.push(`${file}: súbor neexistuje`); continue; }

    const lines = fs.readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const [word, why] of FORBIDDEN) {
        if (line.includes(word)) offenders.push(`${file}:${index + 1} ${why}: ${line.trim().slice(0, 70)}`);
      }
    });
  }

  check(`${SCANNED.length} súborov neobsahuje staré meno`, offenders, []);
}

// Nové meno sa naopak musí objaviť v oboch rozhraniach a v oboch jazykoch -
// prázdny výsledok hľadania by prešiel kontrolou vyššie rovnako dobre ako
// hotová práca.
function scanNewNames() {
  console.log('\n2. Nové meno je na mieste');

  const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
  const portal = read('public/portal/assets/js/portalI18n.js');
  const teams = read('public/assets/js/i18n.js');
  const migration = read('src/database/migrations/040_rename_ocr_to_escort.sql');

  check('portál pozná paragraf - lekár', portal.includes('Paragraf - lekár'), true);
  check('portál pozná paragraf - sprievod', portal.includes('Paragraf - sprievod'), true);
  check('portál má anglický preklad', portal.includes('Family Member Escort'), true);
  check('Teams appka pozná oba', teams.includes('Paragraf - lekár') && teams.includes('Paragraf - sprievod'), true);
  check('Teams appka má anglický preklad', teams.includes('Family Member Escort'), true);

  // Rozbaľovacie menu pri novej žiadosti sa plní z databázy, nie z prekladov,
  // takže bez tejto migrácie by sa premenovanie na tej obrazovke neprejavilo.
  check('migrácia prepisuje slovenský názov',
        migration.includes("'Paragraf - lekár'") && migration.includes("'Paragraf - sprievod'"), true);
  check('migrácia prepisuje anglický názov',
        migration.includes('Family Member Escort'), true);
  check('migrácia nesiaha na kľúče ani na kvóty',
        /UPDATE\s+(tickets|sick_notes|employee_quotas|quota_settings)\b/i.test(migration), false);
}

// =========================================================================
// 3. Zelený zostatok nad formulárom
// =========================================================================

function serve(root) {
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

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 86400 })}.x`;

const ME = { id: 'u1', email: 'jan.novak@etilog.sk', name: 'Ján Novák', role: 'user',
             permissions: ['hr.access'], accessControlMode: 'enforce' };

// Dovolenka v dňoch, oba paragrafy v hodinách - 7 dní nároku je 56 hodín.
const QUOTA = {
  vacation_days_total: 25, vacation_days_used: 5, vacation_days_remaining: 20,
  sick_days_total: 0, sick_days_used: 0, sick_days_remaining: 0,
  paragraph_days_total: 56, paragraph_days_used: 8, paragraph_days_remaining: 48,
  ocr_days_total: 56, ocr_days_used: 40, ocr_days_remaining: 16
};

const TICKET_TYPES = [
  { key: 'vacation',  label_sk: 'Dovolenka',           label_en: 'Vacation',             requires_dates: true,  is_active: true, sort_order: 1 },
  { key: 'paragraph', label_sk: 'Paragraf - lekár',    label_en: "Doctor's Appointment", requires_dates: true,  is_active: true, sort_order: 2 },
  { key: 'ocr',       label_sk: 'Paragraf - sprievod', label_en: 'Family Member Escort', requires_dates: true,  is_active: true, sort_order: 3 },
  { key: 'purchase',  label_sk: 'Nákup',               label_en: 'Purchase',             requires_dates: false, is_active: true, sort_order: 4 }
];

async function openForm(browser, base, errors) {
  const context = await browser.newContext();
  await context.addInitScript((token) => {
    localStorage.setItem('etilog_token', token);
    localStorage.setItem('etilog_auth', 'local');
    localStorage.setItem('etilog_portal_lang', 'sk');
  }, TOKEN);

  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));

  // Od najvšeobecnejšej po najkonkrétnejšiu - posledná zaregistrovaná vyhráva.
  await page.route('**/api/**', (route) => route.fulfill(json([])));
  await page.route('**/api/admin/me', (route) => route.fulfill(json(ME)));
  await page.route('**/api/ticket-types**', (route) => route.fulfill(json(TICKET_TYPES)));
  await page.route('**/api/quotas/me**', (route) => route.fulfill(json(QUOTA)));
  await page.route('**/api/quotas/working-days**', (route) => route.fulfill(json({ working_days: 3 })));

  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`${base}/portal/index.html#my-requests`);
  await page.waitForTimeout(1500);
  await page.evaluate(() => openNewRequestModal());
  await page.waitForSelector('#newRequestForm', { timeout: 10000 });
  await page.waitForTimeout(300);
  return page;
}

const pick = async (page, value) => {
  await page.selectOption('select[name="ticket_type"]', value);
  await page.waitForTimeout(250);
};

const boxVisible = (page) => page.isVisible('#requestQuotaInfoBox');
const boxText = (page) => page.locator('#requestQuotaInfoBox').innerText();

async function screenTests() {
  const server = serve(PUBLIC);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];
  const page = await openForm(browser, base, errors);

  console.log('\n3. Rozbaľovacie menu typu žiadosti');
  const options = await page.locator('select[name="ticket_type"] option').allInnerTexts();
  check('ponúka obe nové mená',
        options.filter((o) => o.startsWith('Paragraf')), ['Paragraf - lekár', 'Paragraf - sprievod']);
  check('staré meno v ňom nie je', options.some((o) => o.includes('OČR')), false);

  console.log('\n4. Zostatok pri dovolenke - v dňoch');
  await pick(page, 'vacation');
  check('box je vidieť', await boxVisible(page), true);
  check('ukazuje zostatok dovolenky', (await boxText(page)).includes('20 dni'), true);

  console.log('\n5. Zostatok pri paragrafe - lekár');
  await pick(page, 'paragraph');
  check('box je vidieť', await boxVisible(page), true);
  check('menuje správny typ', (await boxText(page)).includes('Zostatok paragrafov - lekár'), true);
  check('a počíta v hodinách', (await boxText(page)).includes('48.00 hodín'), true);
  check('prúžok sa kreslí', await page.isVisible('#requestQuotaBar'), true);
  // 8 z 56 hodín je 14,3 % - prúžok má byť zelený, nie oranžový.
  check('a je zelený, kým je z čoho brať',
        await page.locator('#requestQuotaBarFill').getAttribute('class'), 'quota-bar-fill green');

  console.log('\n6. Zostatok pri paragrafe - sprievod');
  await pick(page, 'ocr');
  check('menuje správny typ', (await boxText(page)).includes('Zostatok paragrafov - sprievod'), true);
  check('a má vlastný zostatok', (await boxText(page)).includes('16.00 hodín'), true);
  // 40 zo 56 je 71,4 % - za prahom, takže oranžový.
  check('prúžok varuje, keď je vyčerpaný',
        await page.locator('#requestQuotaBarFill').getAttribute('class'), 'quota-bar-fill amber');

  console.log('\n7. Vybraný rozsah sa prepočíta na hodiny');
  await page.fill('input[name="start_date"]', '2026-11-02');
  await page.fill('input[name="end_date"]', '2026-11-04');
  await page.waitForTimeout(500);
  // Tri pracovné dni po ôsmich hodinách - rovnaký prepočet, aký urobí server.
  check('tri dni sú 24 hodín', (await boxText(page)).includes('24.00 hodín'), true);

  // Sprievod má v tomto teste zostatok 16 hodín, takže 24 sa doň nezmestí.
  // Práve toto je ten prípad, pre ktorý varovanie existuje: bez neho by
  // zamestnanec žiadosť odoslal a odmietol by ju až server.
  check('a nedostatok sa ohlási', await page.isVisible('#quotaWarning'), true);
  check('varovanie hovorí v hodinách, nie v dňoch',
        (await page.locator('#quotaWarning').innerText()).includes('hodín'), true);

  console.log('\n8. Ten istý rozsah pri type, kde zostatok stačí');
  await pick(page, 'paragraph');
  await page.waitForTimeout(500);
  // Lekár má 48 hodín, 24 sa doň zmestí - rovnaké dátumy, iný výsledok.
  check('tie isté dni sa prepočítajú rovnako', (await boxText(page)).includes('24.00 hodín'), true);
  check('a varovanie zmizne', await page.isVisible('#quotaWarning'), false);

  console.log('\n9. Typ bez kvóty zostatok neukazuje');
  await pick(page, 'purchase');
  check('box je schovaný', await boxVisible(page), false);

  check('nič nespadlo', errors, []);

  await page.close();
  await browser.close();
  server.close();
}

async function main() {
  console.log(`\n${DIM}  nad skutočnými súbormi z public/${OFF}`);
  scanFiles();
  scanNewNames();
  await screenTests();
}

main()
  .catch((error) => { console.error(error); failures += 1; })
  .then(() => {
    console.log('');
    console.log(failures
      ? `${RED}${failures} kontrol zlyhalo${OFF}\n`
      : `${GREEN}Všetko prešlo${OFF} - OČR nikde a zostatok sedí pri oboch paragrafoch.\n`);
    process.exit(failures ? 1 : 0);
  });
