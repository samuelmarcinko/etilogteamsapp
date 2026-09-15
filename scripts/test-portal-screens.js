#!/usr/bin/env node
/**
 * Prihlasovacia stránka a rozcestník modulov.
 *
 *   node scripts/test-portal-screens.js
 *
 * Dve obrazovky, ktoré vidí každý zamestnanec, a obe stoja na prekladových
 * kľúčoch a na právach. Chýbajúci kľúč sa neprejaví chybou - na obrazovke
 * zostane holý názov kľúča alebo prázdne miesto, server odpovie 200 a nikto
 * si toho nemusí všimnúť týždeň.
 *
 * Server sa tu nespúšťa; odpovede sa podstrkujú, lebo predmetom skúšky je
 * obrazovka. Beží to nad skutočnými súbormi z `public/`.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

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
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ${GREEN}OK${OFF}   ${label}`);
  } else {
    console.log(`  ${RED}FAIL${OFF} ${label} - čakalo ${JSON.stringify(expected)}, prišlo ${JSON.stringify(actual)}`);
    failures += 1;
  }
}

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

const json = (data) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ success: true, data })
});

const MSAL_CONFIG = {
  clientId: '00000000-0000-0000-0000-000000000001',
  authority: 'https://login.microsoftonline.com/common',
  redirectUri: 'http://127.0.0.1/portal/'
};

// Prehliadač si z tokenu číta len dobu platnosti; podpis overuje server.
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 86400 })}.x`;

async function main() {
  const server = serve(PUBLIC);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  // ---------------------------------------------------------- prihlásenie

  const loginPage = async (lang) => {
    const page = await (await browser.newContext()).newPage();
    page.on('pageerror', (e) => errors.push(`login: ${e.message}`));
    await page.route('**/api/auth/methods', (r) => r.fulfill(json({ password: true })));
    await page.route('**/api/auth/config', (r) => r.fulfill(json(MSAL_CONFIG)));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${base}/portal/login.html`);
    await page.waitForTimeout(600);
    if (lang) { await page.evaluate((l) => authSetLang(l), lang); await page.waitForTimeout(200); }
    return page;
  };

  console.log('\n1. Prihlásenie hovorí, ktorá cesta je čia');
  let page = await loginPage('sk');
  check('sú tam obe cesty', await page.locator('.auth-method').count(), 2);
  const who = await page.locator('.auth-method-who').allInnerTexts();
  check('prvá je pre zamestnancov', who[0], 'ZAMESTNANCI ETILOG');
  check('druhá pre externých', who[1], 'EXTERNÍ PRACOVNÍCI');
  check('pri zamestnancoch stojí Microsoft',
        (await page.locator('.auth-method-primary').innerText()).includes('Microsoft'), true);
  check('pri externých je pole na heslo',
        await page.locator('#authPasswordBlock #authPass').count(), 1);
  check('vysvetlenie nie je prázdne', (await page.locator('.auth-method-hint').allInnerTexts())
        .every((text) => text.trim().length > 30), true);

  console.log('\n2. To isté po anglicky');
  await page.evaluate(() => authSetLang('en'));
  await page.waitForTimeout(200);
  check('preloží sa aj popis ciest', await page.locator('.auth-method-who').allInnerTexts(),
        ['ETILOG EMPLOYEES', 'EXTERNAL WORKERS']);
  check('žiadny nepreložený kľúč',
        (await page.locator('.auth-form').innerText()).includes('login'), false);
  await page.close();

  // Bez hesiel na serveri sa druhá cesta vôbec neponúka.
  page = await (await browser.newContext()).newPage();
  await page.route('**/api/auth/methods', (r) => r.fulfill(json({ password: false })));
  await page.route('**/api/auth/config', (r) => r.fulfill(json(MSAL_CONFIG)));
  await page.goto(`${base}/portal/login.html`);
  await page.waitForTimeout(600);
  console.log('\n3. Keď prihlásenie heslom nie je zapnuté');
  check('externá cesta sa neponúka', await page.isVisible('#authPasswordBlock'), false);
  check('Microsoft zostáva', await page.isVisible('#msBtn'), true);
  await page.close();

  // -------------------------------------------------------------- rozcestník

  const hub = async (profile, lang = 'sk') => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(([t, l]) => {
      localStorage.setItem('etilog_token', t);
      localStorage.setItem('etilog_auth', 'local');
      localStorage.setItem('etilog_portal_lang', l);
    }, [TOKEN, lang]);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`hub: ${e.message}`));
    await p.route('**/api/**', (r) => r.fulfill(json([])));
    await p.route('**/api/admin/me', (r) => r.fulfill(json(profile)));
    await p.route('**/api/auth/config', (r) => r.fulfill(json(MSAL_CONFIG)));
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.goto(`${base}/portal/index.html#hub`);
    await p.waitForTimeout(1200);
    return p;
  };

  const person = { id: 'u', email: 'jan.novak@etilog.sk', name: 'Ján Novák', isKiosk: false, accessControlMode: 'enforce', quota: null };
  const all = ['hr.access', 'hr.manage', 'fleet.access', 'warehouse.read', 'warehouse.write', 'production.view', 'production.manage'];

  console.log('\n4. Rozcestník s prístupom ku všetkému');
  page = await hub({ ...person, role: 'admin', permissions: all });
  check('štyri moduly', await page.locator('.hub-card').count(), 4);
  check('žiadny zamknutý', await page.locator('.hub-card.locked').count(), 0);
  check('pozdrav krstným menom', (await page.locator('.hub-title').innerText()), 'Dobrý deň, Ján');
  check('každá dlaždica ponúka Otvoriť',
        await page.locator('.hub-card-go:not(.locked)').count(), 4);
  await page.close();

  console.log('\n5. Rozcestník bežného zamestnanca');
  page = await hub({ ...person, role: 'user', permissions: ['hr.access'] });
  check('otvorené je len HR', await page.locator('.hub-card:not(.locked)').count(), 1);
  check('ostatné hovoria prečo', await page.locator('.hub-card-go.locked').count(), 3);
  check('a nepredstierajú, že sa dajú otvoriť',
        (await page.locator('.hub-card.locked').first().innerText()).includes('Otvoriť'), false);
  await page.close();

  console.log('\n6. Anglicky');
  page = await hub({ ...person, role: 'admin', permissions: all }, 'en');
  check('pozdrav', await page.locator('.hub-title').innerText(), 'Hello, Ján');
  check('žiadny nepreložený kľúč',
        (await page.locator('.hub-grid').innerText()).includes('hub'), false);
  await page.close();

  check('nič nespadlo', errors, []);

  await browser.close();
  server.close();
}

main()
  .catch((error) => { console.error(error); failures += 1; })
  .then(() => {
    console.log('');
    console.log(failures
      ? `${RED}${failures} kontrol zlyhalo${OFF}\n`
      : `${GREEN}Všetko prešlo${OFF} - obe obrazovky hovoria to, čo majú.\n`);
    process.exit(failures ? 1 : 0);
  });
