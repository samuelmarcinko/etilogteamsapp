#!/usr/bin/env node
/**
 * Vysvetlenie pri zostatkoch - na webe aj v Teamse.
 *
 *   node scripts/test-quota-notice-screen.js
 *
 * Zostatky napojených zamestnancov prichádzajú z PAM, a PAM pozná len to,
 * čo mzdová učtáreň zúčtovala. Dovolenka vybratá minulý týždeň v tom čísle
 * ešte nie je. Kto to nevie, naplánuje si dni, ktoré už minul - a zistí to
 * až keď mu žiadosť neprejde.
 *
 * Tri veci, ktoré sa tu strážia:
 *
 *   1. Vysvetlenie je na oboch obrazovkách - nástenka v Teamse aj HR modul
 *      na webe. Keby bolo len na jednej, polovica ľudí ho nikdy neuvidí.
 *   2. Je v ňom konkrétny mesiac, nie „minulý mesiac". Mzdy sa
 *      nezúčtovávajú vždy rovnako skoro.
 *   3. Nenapojeným sa NEzobrazuje. Tým appka kvótu odpočítava hneď pri
 *      schválení, takže ich zostatok je aktuálny a veta by im klamala.
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
  console.log(ok
    ? `  ${GREEN}OK${OFF}   ${label}`
    : `  ${RED}FAIL${OFF} ${label} - čakalo ${JSON.stringify(expected)}, prišlo ${JSON.stringify(actual)}`);
  if (!ok) failures += 1;
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

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 86400 })}.x`;

/** Zborovjanove skutočné čísla, mzdy zúčtované po august. */
const FROM_PAM = {
  user_id: 'u', year: 2026, quota_source: 'pam', pam_last_month: 8,
  vacation_days_total: 43.5, vacation_days_used: 26, vacation_days_remaining: 17.5,
  paragraph_days_total: 56, paragraph_days_used: 31.75, paragraph_days_remaining: 24.25,
  ocr_days_total: 56, ocr_days_used: 8, ocr_days_remaining: 48,
  sick_days_total: 5, sick_days_used: 0, sick_days_remaining: 5,
  vacation_days_pending: 2, paragraph_days_pending: 0, ocr_days_pending: 9.54
};

/** Ten istý človek, keby na PAM napojený nebol. */
const MANUAL = { ...FROM_PAM, quota_source: 'manual', pam_last_month: null,
                 vacation_days_pending: 0, ocr_days_pending: 0 };

async function main() {
  const server = serve(PUBLIC);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  // ------------------------------------------------------ HR modul na webe

  const portal = async (quota, lang = 'sk') => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(([t, l]) => {
      localStorage.setItem('etilog_token', t);
      localStorage.setItem('etilog_auth', 'local');
      localStorage.setItem('etilog_portal_lang', l);
    }, [TOKEN, lang]);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`portal: ${e.message}`));
    await p.route('**/api/**', (r) => r.fulfill(json([])));
    await p.route('**/api/admin/me', (r) => r.fulfill(json({
      id: 'u', email: 'jan.novak@etilog.sk', name: 'Ján Novák', role: 'user',
      permissions: ['hr.access'], accessControlMode: 'enforce', isKiosk: false
    })));
    await p.route('**/api/quotas/me**', (r) => r.fulfill(json(quota)));
    await p.setViewportSize({ width: 1280, height: 1000 });
    await p.goto(`${base}/portal/index.html#my-quotas`);
    await p.waitForTimeout(1200);
    return p;
  };

  console.log('\n1. HR modul na webe, zamestnanec napojený na PAM');
  let page = await portal(FROM_PAM);
  check('vysvetlenie je na obrazovke', await page.locator('.quota-notice').count(), 1);
  let text = await page.locator('.quota-notice').innerText();
  check('hovorí, k čomu sa zostatok vzťahuje', text.includes('poslednej zúčtovanej mzde'), true);
  // Konkrétny mesiac, nie „minulý mesiac" - mzdy sa nezúčtovávajú vždy
  // rovnako skoro a rozdiel medzi augustom a septembrom je práve to, čo
  // človek potrebuje vedieť.
  check('aj s konkrétnym mesiacom', text.includes('august'), true);
  check('a s rokom', text.includes('2026'), true);
  check('povie, kedy sa to zmení', text.includes('ďalšej mzdy'), true);
  check('vymenuje, čo ešte nie je započítané', text.includes('Zatiaľ nespracované'), true);
  check('aj s hodinami sprievodu', text.includes('9.54'), true);
  check('aj s dňami dovolenky', text.includes('2.00'), true);
  await page.close();

  console.log('\n2. Nenapojenému sa nezobrazuje');
  // Tomuto appka kvótu odpočítava hneď pri schválení, takže jeho zostatok
  // je aktuálny. Veta o zúčtovaní mzdy by mu klamala.
  page = await portal(MANUAL);
  check('žiadne vysvetlenie', await page.locator('.quota-notice').count(), 0);
  check('ale zostatok tam je', (await page.locator('.page-body').innerText()).includes('17.5'), true);
  await page.close();

  console.log('\n3. To isté po anglicky');
  page = await portal(FROM_PAM, 'en');
  text = await page.locator('.quota-notice').innerText();
  check('preloží sa', text.includes('last processed payroll'), true);
  check('mesiac po anglicky', text.includes('August'), true);
  check('žiadny nepreložený kľúč', text.includes('quotaNotice'), false);
  await page.close();

  // -------------------------------------------------------- nástenka v Teamse

  const teams = async (quota, lang = 'sk') => {
    const ctx = await browser.newContext();
    await ctx.addInitScript((l) => {
      localStorage.setItem('appLanguage', l);
      localStorage.setItem('userId', 'u');
      localStorage.setItem('userName', 'Ján Novák');
      localStorage.setItem('userEmail', 'jan.novak@etilog.sk');
    }, lang);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`teams: ${e.message}`));
    await p.route('**/api/**', (r) => r.fulfill(json([])));
    await p.route('**/api/teams-dashboard**', (r) => r.fulfill(json({
      quota, nextHolidays: [], ticketStats: { pending: 0, approved: 0, rejected: 0 }
    })));
    await p.setViewportSize({ width: 1280, height: 1000 });
    await p.goto(`${base}/pages/dashboard.html`);
    await p.waitForTimeout(1500);
    // Teams SDK v prehliadači nie je, tak sa karty naplnia priamo - predmetom
    // skúšky je to, čo renderOverviewCards nakreslí, nie prihlásenie.
    await p.evaluate((q) => renderOverviewCards({ quota: q, nextHolidays: [] }), quota);
    await p.waitForTimeout(200);
    return p;
  };

  console.log('\n4. Nástenka v Teamse');
  page = await teams(FROM_PAM);
  check('vysvetlenie je vidieť', await page.isVisible('#quotaNotice'), true);
  text = await page.locator('#quotaNotice').innerText();
  check('to isté, čo na webe', text.includes('poslednej zúčtovanej mzde'), true);
  check('s konkrétnym mesiacom', text.includes('august'), true);
  check('aj s nespracovanými', text.includes('9.54'), true);
  await page.close();

  console.log('\n5. Nenapojenému ani v Teamse');
  page = await teams(MANUAL);
  check('vysvetlenie je skryté', await page.isVisible('#quotaNotice'), false);
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
      : `${GREEN}Všetko prešlo${OFF} - zamestnanec vidí, k akému mesiacu zostatok je.\n`);
    process.exit(failures ? 1 : 0);
  });
