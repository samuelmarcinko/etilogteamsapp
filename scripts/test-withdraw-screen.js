#!/usr/bin/env node
/**
 * Vyskladnenie - obrazovka v prehliadači.
 *
 *   node scripts/test-withdraw-screen.js
 *
 * Serverová časť má vlastné testy; toto skúša to, čo sa na nich nedá overiť -
 * ako sa obrazovka správa pod rukami človeka, ktorý sa ponáhľa.
 *
 * Vzniklo to preto, že políčko na číslo materiálu prehadzovalo znaky: pri
 * každom písmene sa prekreslila celá obrazovka, políčko sa zahodilo a vyrobilo
 * nanovo, a znaky napísané medzitým skončili v inom poradí. Kto písal
 * RM102750 rýchlo, dostal M102750R. Na obrázku to vyzeralo v poriadku a
 * server o tom nemal ako vedieť.
 *
 * Server sa tu nespúšťa - odpovede sa podstrkujú, lebo predmetom skúšky je
 * obrazovka, nie API. Beží to nad skutočnými súbormi z `public/`.
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  console.error('\nPlaywright nie je nainštalovaný (npm install), tento test sa bez neho nespustí.\n');
  process.exit(1);
}

// V tomto kontajneri je prehliadač na pevnej ceste; inde si ho Playwright
// nájde sám.
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const PUBLIC = path.join(__dirname, '..', 'public');
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const OFF = '\x1b[0m';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ${GREEN}OK${OFF}   ${label}`);
  } else {
    console.log(`  ${RED}FAIL${OFF} ${label} - čakalo ${JSON.stringify(expected)}, prišlo ${JSON.stringify(actual)}`);
    failures += 1;
  }
}

/**
 * Stránka, ktorá načíta skutočné CSS a skutočný skript obrazovky a dodá mu len
 * to, čo inak dodáva portál: pár pomocných funkcií a odpovede servera.
 */
const HARNESS = `<!DOCTYPE html><html lang="sk"><head><meta charset="utf-8">
<link rel="stylesheet" href="/portal/assets/css/portal.css">
<link rel="stylesheet" href="/portal/assets/css/withdraw.css">
<title>test</title></head><body class="wd-active">
<div class="portal-layout"><main class="main-content"><div id="pageContent"></div></main></div>
<script>
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const showToast = () => {};
const hasModuleAccess = () => true;
const canEditWarehouse = () => true;
const navigateToPage = () => {};
const whFormatDate = (d) => new Date(d).toLocaleString('sk-SK');

const MATERIALS = [
  { id: 1, code: 'RM102750', name: 'Kartón 400x300x200 3VVL', kind: 'sap', unit: 'ks', quantity: 374,
    placements: [
      { location_id: 11, location_code: 'B1', zone: 'B', position: 1, quantity: 120 },
      { location_id: 14, location_code: 'B4', zone: 'B', position: 4, quantity: 34 }
    ] },
  { id: 2, code: null, name: 'Tašky HKP', kind: 'local', unit: 'ks', quantity: 1, project_fg: 'FG100875',
    placements: [{ location_id: 21, location_code: 'A2', zone: 'A', position: 2, quantity: 1 }] },
  // Ďalšie kódy začínajúce na RM, aby zoznam výsledkov presiahol obrazovku -
  // presne vtedy sa ukáže, či sa pole udrží na mieste.
  ...Array.from({ length: 7 }, (_, i) => ({
    id: 10 + i, code: 'RM10' + (2800 + i), name: 'Kartón typ ' + (i + 1),
    kind: 'sap', unit: 'ks', quantity: 50,
    placements: [{ location_id: 30 + i, location_code: 'C' + (i + 1), zone: 'C', position: i + 1, quantity: 50 }]
  }))
];

window.__sent = [];
async function apiCall(url, options = {}) {
  const json = (data, ok = true, status = 200) =>
    ({ ok, status, json: async () => (ok ? { data } : data) });
  if (url.includes('/withdrawals/session'))
    return json({ name: 'Tablet', kiosk: true, hasPin: true, pinLength: 4 });
  if (url.includes('/withdrawals/unlock')) return json({ unlockToken: 'test' });
  if (url.includes('/withdrawals/search')) {
    const q = decodeURIComponent(url.split('q=')[1] || '').toLowerCase();
    return json(MATERIALS.filter(m =>
      (m.code || '').toLowerCase().includes(q) || m.name.toLowerCase().includes(q)));
  }
  if (url.endsWith('/withdrawals')) {
    window.__sent.push(JSON.parse(options.body));
    return json({ id: 1 }, true, 201);
  }
  return json({});
}
<\/script>
<script src="/portal/assets/js/warehouseWithdraw.js"><\/script>
</body></html>`;

function serve(root, harnessPath) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                  '.svg': 'image/svg+xml', '.png': 'image/png' };
  return http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = url === '/test.html' ? harnessPath : path.join(root, url);
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-test-'));
  const harnessPath = path.join(dir, 'test.html');
  fs.writeFileSync(harnessPath, HARNESS);

  const server = serve(PUBLIC, harnessPath);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Redmi Pad na šírku - tak, ako visí na stene.
  await page.setViewportSize({ width: 1340, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/test.html`);
  await page.evaluate(() => renderWarehouseWithdraw(document.getElementById('pageContent')));
  await page.waitForTimeout(300);

  console.log('\n1. Odomknutie PINom');
  check('začína zamknuté', await page.isVisible('.wd-lock'), true);
  for (const d of ['4', '8', '3', '1']) {
    await page.click(`.wd-key:text-is("${d}")`);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(300);
  check('po PINe pýta číslo materiálu', await page.isVisible('#wdQuery'), true);

  console.log('\n2. Klávesnica na tablete');
  check('pole sa neaktivuje samo', await page.evaluate(() => document.activeElement?.id !== 'wdQuery'), true);

  // Vysunutá klávesnica z 12-palcového displeja nechá pruh vysoký asi 360 bodov.
  // Hlavička s tlačidlom Zrušiť aj samotné pole musia zostať vidieť.
  await page.setViewportSize({ width: 1340, height: 360 });
  await page.waitForTimeout(200);
  check('hlavička zostala na obrazovke', await page.isVisible('.wd-head'), true);
  check('tlačidlo Zrušiť je dosiahnuteľné', await page.isVisible('.wd-cancel'), true);
  check('pole je vidieť', await page.isVisible('#wdQuery'), true);
  check('stránka sa nikam neodroluje', await page.evaluate(
    () => document.documentElement.scrollHeight <= window.innerHeight + 1), true);

  const box = await page.locator('#wdQuery').boundingBox();
  check('pole sedí vo viditeľnej časti', box.y >= 0 && box.y + box.height <= 360, true);

  // Toto je ten prípad, ktorý sa pokazil: prišli výsledky, obsah prerástol
  // obrazovku a pole sa vysunulo hore pod hlavičku. Rolovať sa má zoznam, nie
  // celá obrazovka.
  await page.click('#wdQuery');
  await page.type('#wdQuery', 'RM10', { delay: 40 });
  await page.waitForTimeout(700);

  const many = await page.evaluate(() => wdState.matches.length);
  check('výsledkov je viac, než sa zmestí', many >= 6, true);

  const after = await page.locator('#wdQuery').boundingBox();
  const head = await page.locator('.wd-head').boundingBox();
  check('pole sa nikam nepohlo', Math.round(after.y), Math.round(box.y));
  check('a nezaliezlo pod hlavičku', after.y >= head.y + head.height - 1, true);
  check('stránka stále nemá kam rolovať', await page.evaluate(
    () => document.documentElement.scrollHeight <= window.innerHeight + 1), true);
  check('roluje sa zoznam výsledkov', await page.evaluate(() => {
    const el = document.getElementById('wdHits');
    return el.scrollHeight > el.clientHeight;
  }), true);
  check('prvý výsledok je hneď pod poľom', await page.evaluate(() => {
    const hit = document.querySelector('.wd-hit').getBoundingClientRect();
    return hit.top > 0 && hit.top < window.innerHeight;
  }), true);

  // Posuvník si kreslíme sami práve preto, že ten prehliadačový sa na
  // dotykovom zariadení nevykreslí - a nikto by nevedel, že zoznam pokračuje.
  check('posuvník je vidieť', await page.isVisible('.wd-scroll'), true);
  const thumb = await page.locator('#wdScrollThumb').boundingBox();
  check('a má bežec primeranej výšky', thumb.height >= 40 && thumb.height < 181, true);

  const before = thumb.y;
  await page.evaluate(() => { document.getElementById('wdHits').scrollTop = 400; });
  await page.waitForTimeout(150);
  check('bežec sa pri rolovaní posunie',
        (await page.locator('#wdScrollThumb').boundingBox()).y > before, true);

  // Keď sa zoznam zmestí celý, posuvník nemá čo ukazovať.
  await page.fill('#wdQuery', '');
  await page.type('#wdQuery', 'tašky', { delay: 40 });
  await page.waitForTimeout(700);
  check('pri jednom výsledku je posuvník preč', await page.isVisible('.wd-scroll'), false);

  await page.evaluate(() => { document.getElementById('wdQuery').value = ''; wdSearch(''); });
  await page.setViewportSize({ width: 1340, height: 800 });
  await page.waitForTimeout(200);

  console.log('\n3. Písanie kódu');
  const type = async (text, delay) => {
    await page.evaluate(() => { document.getElementById('wdQuery').value = ''; wdSearch(''); });
    await page.click('#wdQuery');
    await page.type('#wdQuery', text, { delay });
    await page.waitForTimeout(700);
    return page.inputValue('#wdQuery');
  };

  // 120 ms je bežné písanie, 0 ms je hranica, na ktorej sa prekresľovanie a
  // písanie stretávali. Znaky musia zostať v poradí pri každej rýchlosti.
  for (const delay of [120, 30, 0]) {
    check(`kód prežije písanie s pauzou ${delay} ms`, await type('RM102750', delay), 'RM102750');
  }
  check('a našiel sa materiál', await page.evaluate(() => wdState.matches.length), 1);
  check('kurzor zostal v poli', await page.evaluate(() => document.activeElement?.id), 'wdQuery');
  check('vlastnú položku nájde názov', (await type('tašky', 30)) === 'tašky', true);

  console.log("\n4. Celá cesta výdaja");
  await type('RM102750', 30);
  await page.click('.wd-hit');
  await page.waitForTimeout(200);
  check('dve pozície - pýta sa, z ktorej', await page.evaluate(() => wdState.step), 'place');
  await page.click('.wd-place >> nth=0');
  await page.waitForTimeout(200);
  for (const d of ['2', '0']) await page.click(`.wd-pad-wide .wd-key:text-is("${d}")`);
  check('počet sa naťukal', await page.evaluate(() => wdState.quantity), '20');
  await page.click('.wd-primary:text-is("Pokračovať")');
  await page.waitForTimeout(200);
  check('súhrn ukazuje, čo zostane', (await page.textContent('.wd-summary')).includes('100'), true);
  await page.click('.wd-primary:text-is("Vyskladniť")');
  await page.waitForTimeout(400);
  check('odoslalo sa presne to, čo si vybral',
        await page.evaluate(() => window.__sent[0]), { materialId: 1, locationId: 11, quantity: 20 });
  check('a obrazovka to potvrdila', await page.isVisible('.wd-done'), true);

  console.log("\n5. Vlastná položka");
  await page.evaluate(() => wdReset());
  await type('tašky', 30);
  await page.click('.wd-hit');
  await page.waitForTimeout(200);
  check('jedna pozícia - krok sa preskočí', await page.evaluate(() => wdState.step), 'quantity');
  check('a nechýba upozornenie, že počet je len poznámka',
        (await page.textContent('.wd-note')).includes('poznámka'), true);
  for (const d of ['1', '5']) await page.click(`.wd-pad-wide .wd-key:text-is("${d}")`);
  await page.click('.wd-primary:text-is("Pokračovať")');
  await page.waitForTimeout(200);
  check('výdaj nad zapísaný počet prejde', await page.evaluate(() => wdState.step), 'confirm');

  console.log("\n6. Nad stav pri položke zo SAPu");
  await page.evaluate(() => wdReset());
  await type('RM102750', 30);
  await page.click('.wd-hit');
  await page.waitForTimeout(200);
  await page.click('.wd-place >> nth=1');   // B4, 34 ks
  await page.waitForTimeout(200);
  for (const d of ['9', '9', '9']) await page.click(`.wd-pad-wide .wd-key:text-is("${d}")`);
  await page.click('.wd-primary:text-is("Pokračovať")');
  await page.waitForTimeout(200);
  check('nepustí ďalej', await page.evaluate(() => wdState.step), 'quantity');
  check('a povie, koľko tam je', (await page.textContent('.wd-error')).includes('34'), true);

  check('nič nespadlo', errors, []);

  await browser.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

main()
  .catch((error) => { console.error(error); failures += 1; })
  .then(() => {
    console.log('');
    console.log(failures
      ? `${RED}${failures} kontrol zlyhalo${OFF} - obrazovku takto nenasadzuj.\n`
      : `${GREEN}Všetko prešlo${OFF} - obrazovka drží aj pod rukami.\n`);
    process.exit(failures ? 1 : 0);
  });
