#!/usr/bin/env node
/**
 * Prepočet kvót z PAM.
 *
 *   node scripts/test-pam-sync.js
 *
 * Beží proti podvrhnutému PAM, nie proti skutočnému - ale s číslami, ktoré
 * skutočný PAM vrátil pre Martina Zborovjana (os. č. 412) a ktoré sme ručne
 * overili proti tomu, čo appke nastavila kolegyňa:
 *
 *   nárok   43,50 dňa   (dov_stara 18,50 + dov_nova 25,00)
 *   401     60,00 h  \  dovolenka, spolu 208 h = 26 dní
 *   402    148,00 h  /
 *   561     31,75 h     paragraf - lekár   -> 56 - 31,75 = 24,25
 *   563      8,00 h     paragraf - sprievod -> 56 -  8,00 = 48,00
 *
 *   43,50 - 26,00 = 17,50, čo je presne to, čo appka ukazuje.
 *
 * Práve ten prepočet je tu to krehké: dovolenka sa v appke vedie v dňoch,
 * ale PAM ju - rovnako ako paragrafy - čerpá v hodinách. Keby sa delenie
 * ôsmimi raz stratilo alebo pridalo navyše, kvóta by nevyzerala pokazene,
 * len by bola osemkrát vedľa.
 *
 * Skript si vyrobí vlastných používateľov a na konci ich zmaže. Proti inému
 * než lokálnemu serveru sa odmietne spustiť.
 */

require('dotenv').config();

const dbHost = process.env.DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '/tmp'].includes(dbHost) && process.env.ALLOW_REMOTE_DB !== 'yes') {
  console.error(`\nOdmietam bežať proti ${dbHost}. Toto je test, nie nástroj na produkčné dáta.\n`);
  process.exit(1);
}
process.env.LOG_LEVEL = 'error';

const pool = require('../src/database/config');
const { PamSyncService, PamLookupError } = require('../src/services/pamSyncService');
const { PamError } = require('../src/services/pamClient');

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

const YEAR = 2026;
const USERS = ['zz-pamsync-martin', 'zz-pamsync-extern', 'zz-pamsync-bez-cisla'];

/**
 * PAM, ktorý odpovedá presne to, čo odpovedal skutočný.
 *
 * Rozoznáva dotazy podľa tabuľky, na ktorú sa pýtajú - nie podľa presného
 * textu, aby sa test nerozbil pri preformátovaní SQL, ale aby stále
 * dokazoval, že sa pýtame tam, kam si myslíme.
 */
function fakePam({ people = { 412: { meno: 'Martin', priezvisko: 'Zborovjan' } },
                   entitlement = { 412: { riadkov: 1, narok: 43.50 } },
                   usage = { 412: [{ kod: 401, hodiny: 60 }, { kod: 402, hodiny: 148 },
                                   { kod: 561, hodiny: 31.75 }, { kod: 563, hodiny: 8 }] },
                   down = false } = {}) {
  const seen = [];
  return {
    seen,
    async query(text, params) {
      if (down) throw new PamError('PAM connection failed: ETIMEDOUT');
      seen.push(text.replace(/\s+/g, ' ').trim());
      const who = params.osobne;

      if (text.includes('z_identifikacia')) {
        return people[who] ? [people[who]] : [];
      }
      if (text.includes('z_dovolenka')) {
        const row = entitlement[who];
        return [row || { riadkov: 0, narok: null }];
      }
      if (text.includes('z_vysl_brutto')) {
        return usage[who] || [];
      }
      throw new Error(`neočakávaný dotaz: ${text}`);
    }
  };
}

const cleanup = async () => {
  await pool.query('DELETE FROM employee_quotas WHERE user_id = ANY($1)', [USERS]);
  await pool.query('DELETE FROM users WHERE user_id = ANY($1)', [USERS]);
};

/** Čo je o človeku uložené v pam_* stĺpcoch. */
const stored = async (userId) => {
  const { rows } = await pool.query(
    `SELECT pam_vacation_days_total AS total, pam_vacation_days_used AS used,
            pam_paragraph_days_used AS paragraph, pam_ocr_days_used AS ocr,
            pam_synced_at IS NOT NULL AS synced
       FROM employee_quotas WHERE user_id = $1 AND year = $2`,
    [userId, YEAR]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    total: Number(r.total), used: Number(r.used),
    paragraph: Number(r.paragraph), ocr: Number(r.ocr), synced: r.synced
  };
};

async function main() {
  await cleanup();

  for (const [id, name, number, external] of [
    ['zz-pamsync-martin', 'Martin Testovací', 412, false],
    ['zz-pamsync-extern', 'Externý Testovací', null, true],
    ['zz-pamsync-bez-cisla', 'Bez Čísla', null, false]
  ]) {
    await pool.query(
      `INSERT INTO users (user_id, email, display_name, role, auth_provider, is_active,
                          personal_number, is_external)
       VALUES ($1, $2, $3, 'user', 'azure', TRUE, $4, $5)`,
      [id, `${id}@etilog.local`, name, number, external]
    );
  }
  const martin = { user_id: 'zz-pamsync-martin', display_name: 'Martin Testovací',
                   personal_number: 412, is_external: false };

  console.log('\n1. Prepočet sedí na skutočné čísla');
  const pam = fakePam();
  const read = await new PamSyncService(pam).read(412, YEAR);
  check('meno z PAM', read.name, 'Martin Zborovjan');
  check('nárok na dovolenku v dňoch', read.vacationTotal, 43.5);
  // 60 + 148 = 208 hodín, teda 26 dní. Toto je to delenie ôsmimi.
  check('čerpaná dovolenka prepočítaná na dni', read.vacationUsed, 26);
  check('zostatok dovolenky', read.vacationTotal - read.vacationUsed, 17.5);
  // Paragrafy zostávajú v hodinách na oboch stranách - tu sa nedelí nič.
  check('paragraf - lekár zostáva v hodinách', read.paragraphUsed, 31.75);
  check('paragraf - sprievod zostáva v hodinách', read.ocrUsed, 8);
  check('zostatok lekára proti zákonným 56 h', 56 - read.paragraphUsed, 24.25);
  check('zostatok sprievodu proti zákonným 56 h', 56 - read.ocrUsed, 48);

  console.log('\n2. Pýtame sa tam, kam si myslíme');
  check('na meno do z_identifikacia', pam.seen.some((q) => q.includes('z_identifikacia')), true);
  check('na nárok do z_dovolenka', pam.seen.some((q) => q.includes('z_dovolenka')), true);
  check('na čerpanie do z_vysl_brutto', pam.seen.some((q) => q.includes('z_vysl_brutto')), true);
  check('a nikdy na vysb_koruny', pam.seen.some((q) => q.includes('vysb_koruny')), false);
  check('ani na ido_rod_cis', pam.seen.some((q) => q.includes('ido_rod_cis')), false);

  console.log('\n3. Uloží sa to vedľa ručných hodnôt');
  await new PamSyncService(fakePam()).syncUser(martin, YEAR);
  check('pam_* stĺpce sú vyplnené', await stored('zz-pamsync-martin'),
        { total: 43.5, used: 26, paragraph: 31.75, ocr: 8, synced: true });
  const manual = await pool.query(
    'SELECT vacation_days_total, vacation_days_used FROM employee_quotas WHERE user_id = $1 AND year = $2',
    ['zz-pamsync-martin', YEAR]
  );
  // Jadro tichého behu: ručné hodnoty sa nesmú pohnúť, inak sa nedá
  // porovnať, či sa na PAM dá prepnúť.
  check('ručná kvóta zostala nedotknutá',
        Number(manual.rows[0].vacation_days_used), 0);

  console.log('\n4. Koho sa nepýtame');
  const refuse = async (user) => {
    try { await new PamSyncService(fakePam()).syncUser(user, YEAR); return 'prešlo'; }
    catch (error) { return error instanceof PamLookupError ? error.code : `iná chyba: ${error.message}`; }
  };
  check('externého', await refuse({ user_id: 'zz-pamsync-extern', is_external: true }), 'external');
  check('nespárovaného', await refuse({ user_id: 'zz-pamsync-bez-cisla', personal_number: null }), 'unmapped');

  console.log('\n5. Čo PAM nevie');
  const unknown = await refuse({ user_id: 'x', personal_number: 999, is_external: false });
  check('osobné číslo, ktoré neexistuje', unknown, 'unknown_personal_number');

  const noEntitlement = new PamSyncService(fakePam({ entitlement: {} }));
  let code = null;
  try { await noEntitlement.syncUser(martin, YEAR); } catch (e) { code = e.code; }
  check('človek bez nároku za daný rok', code, 'no_entitlement');

  console.log('\n6. Keď je PAM dole, staré hodnoty zostanú ležať');
  // Najdôležitejšia vlastnosť celého behu. Keby sa pri chybe zapísali nuly,
  // kvóta by sa niekomu tichučko vynulovala a na obrazovke by to vyzeralo
  // ako platný údaj.
  let downError = null;
  try { await new PamSyncService(fakePam({ down: true })).syncUser(martin, YEAR); }
  catch (error) { downError = error; }
  check('synchronizácia zlyhá', downError instanceof PamError, true);
  check('a hodnoty z minulého behu sú tam, kde boli', await stored('zz-pamsync-martin'),
        { total: 43.5, used: 26, paragraph: 31.75, ocr: 8, synced: true });

  console.log('\n7. Viac riadkov nároku na jeden rok sa nezamlčí');
  const twoRows = await new PamSyncService(
    fakePam({ entitlement: { 412: { riadkov: 2, narok: 50 } } })
  ).read(412, YEAR);
  check('vráti sa počet riadkov', twoRows.entitlementRows, 2);
}

main()
  .catch((error) => { console.error(error); failures += 1; })
  .then(async () => {
    await cleanup().catch(() => {});
    await pool.end().catch(() => {});
    console.log('');
    console.log(failures
      ? `${RED}${failures} kontrol zlyhalo${OFF}\n`
      : `${GREEN}Všetko prešlo${OFF} - 43,50 - 26,00 = 17,50, presne ako v PAM.\n`);
    process.exit(failures ? 1 : 0);
  });
