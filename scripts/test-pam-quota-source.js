#!/usr/bin/env node
/**
 * Odkiaľ sa berie kvóta, a komu sa (ne)odpočítava.
 *
 *   node scripts/test-pam-quota-source.js
 *
 * Toto je to prepnutie. Po ňom platí: kto je napojený na PAM, tomu sa
 * kvóta číta z PAM a appka mu pri schválení neodpočíta nič. Kto napojený
 * nie je - externí a tí, ktorým kolegyňa ešte nezadala osobné číslo -
 * funguje presne ako doteraz.
 *
 * Tá druhá polovica je tu dôležitejšia než prvá. Osobné čísla sa budú
 * dopĺňať postupne, takže väčšina ľudí bude ešte dlho na ručných
 * hodnotách. Keby im prepnutie kvótu zhaslo alebo prestalo odpočítavať,
 * prišlo by sa na to až keď si niekto vyberie viac dovolenky, než má.
 *
 * Skript si vyrobí vlastných používateľov a žiadosti a na konci ich po
 * sebe zmaže. Proti inému než lokálnemu serveru sa odmietne spustiť.
 */

require('dotenv').config();

const dbHost = process.env.DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '/tmp'].includes(dbHost) && process.env.ALLOW_REMOTE_DB !== 'yes') {
  console.error(`\nOdmietam bežať proti ${dbHost}. Toto je test, nie nástroj na produkčné dáta.\n`);
  process.exit(1);
}
process.env.LOG_LEVEL = 'error';

const pool = require('../src/database/config');
const Quota = require('../src/database/models/Quota');

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
const NAPOJENY = 'zz-src-napojeny';
const BEZ_CISLA = 'zz-src-bez-cisla';
const EXTERNY = 'zz-src-externy';
const USERS = [NAPOJENY, BEZ_CISLA, EXTERNY];

async function cleanup() {
  await pool.query('DELETE FROM tickets WHERE created_by_id = ANY($1)', [USERS]);
  await pool.query('DELETE FROM employee_quotas WHERE user_id = ANY($1)', [USERS]);
  await pool.query('DELETE FROM users WHERE user_id = ANY($1)', [USERS]);
}

const ziadost = (userId, type, od, amount, status = 'Approved') => pool.query(
  `INSERT INTO tickets (ticket_id, title, description, ticket_type, status,
                        created_by_id, created_by_name, created_by_email,
                        start_date, end_date, quota_amount)
   VALUES ($1, 'test', 'test', $2, $3, $4, 'Test', 'test@etilog.local', $5, $5, $6)`,
  [`ZZ-${Math.random().toString(36).slice(2, 10)}`, type, status, userId, od, amount]
);

async function main() {
  await cleanup();

  for (const [id, number, external] of [
    [NAPOJENY, 412, false],
    [BEZ_CISLA, null, false],
    [EXTERNY, null, true]
  ]) {
    await pool.query(
      `INSERT INTO users (user_id, email, display_name, role, auth_provider, is_active,
                          personal_number, is_external)
       VALUES ($1, $2, $1, 'user', 'azure', TRUE, $3, $4)`,
      [id, `${id}@etilog.local`, number, external]
    );
    await Quota.getOrCreate(id, YEAR);
  }

  // Ručné hodnoty, aké tam má dnes kolegyňa. Pri napojenom človeku zostanú
  // ležať a nesmú sa nikde ukázať - to je jedna z kontrol nižšie.
  await Quota.updateQuotaFull(NAPOJENY, YEAR, {
    vacation_days_total: 25, vacation_days_used: 10,
    paragraph_days_total: 56, paragraph_days_used: 41.29,
    ocr_days_total: 56, ocr_days_used: 8
  });
  await Quota.updateQuotaFull(BEZ_CISLA, YEAR, {
    vacation_days_total: 25, vacation_days_used: 4,
    paragraph_days_total: 56, paragraph_days_used: 0,
    ocr_days_total: 56, ocr_days_used: 0
  });

  console.log('\n1. Bez synchronizácie sa nič nemení');
  // Samotné zadané osobné číslo ešte nestačí. Kým PAM neodpovedal, nemáme
  // čo zobraziť - a taký človek musí zostať na ručných hodnotách, nie
  // ostať bez kvóty.
  let q = await Quota.effective(NAPOJENY, YEAR);
  check('zdroj je ručný', q.quota_source, 'manual');
  check('zostatok dovolenky je ten ručný', q.vacation_days_remaining, 15);

  console.log('\n2. Po synchronizácii sa zdrojom stáva PAM');
  // Skutočné Zborovjanove čísla: nárok 43,50 dňa, čerpaných 26 dní,
  // 31,75 h lekára, 8 h sprievodu. Mzdy spracované do augusta.
  await Quota.setPamValues(NAPOJENY, YEAR, {
    vacationTotal: 43.5, vacationUsed: 26, paragraphUsed: 31.75, ocrUsed: 8, lastMonth: 8
  });
  q = await Quota.effective(NAPOJENY, YEAR);
  check('zdroj je PAM', q.quota_source, 'pam');
  check('nárok z PAM', q.vacation_days_total, 43.5);
  check('zostatok dovolenky z PAM', q.vacation_days_remaining, 17.5);
  check('zostatok lekára z PAM', q.paragraph_days_remaining, 24.25);
  check('zostatok sprievodu z PAM', q.ocr_days_remaining, 48);
  // Nárok na paragrafy PAM nevedie - je zo zákona a ostáva z nastavení.
  check('nárok na paragrafy zostáva z appky', q.paragraph_days_total, 56);

  console.log('\n3. Ručné hodnoty tam zostanú ležať, ale nikde sa neukážu');
  const raw = await pool.query(
    'SELECT vacation_days_used, paragraph_days_used FROM employee_quotas WHERE user_id = $1 AND year = $2',
    [NAPOJENY, YEAR]
  );
  check('v databáze sú nedotknuté',
        [Number(raw.rows[0].vacation_days_used), Number(raw.rows[0].paragraph_days_used)], [10, 41.29]);
  check('ale zobrazuje sa PAM', q.vacation_days_used, 26);

  console.log('\n4. Nenapojení fungujú presne ako doteraz');
  const bez = await Quota.effective(BEZ_CISLA, YEAR);
  check('bez osobného čísla: ručný zdroj', bez.quota_source, 'manual');
  check('bez osobného čísla: ručný zostatok', bez.vacation_days_remaining, 21);
  // Externý má osobné číslo zahodené už pri ukladaní, ale aj keby ho mal,
  // nesmie čítať z PAM - v PAM nie je.
  await pool.query('UPDATE users SET personal_number = 999 WHERE user_id = $1', [EXTERNY]);
  await Quota.setPamValues(EXTERNY, YEAR, {
    vacationTotal: 99, vacationUsed: 0, paragraphUsed: 0, ocrUsed: 0, lastMonth: 8
  });
  const ext = await Quota.effective(EXTERNY, YEAR);
  check('externý ostáva ručný aj s číslom a so synchronizáciou', ext.quota_source, 'manual');
  check('a nevidí nárok z PAM', ext.vacation_days_total, 20);

  console.log('\n5. Schválenie neodpočítava napojenému, nenapojenému áno');
  check('napojenému sa neodpočíta',
        await Quota.addUsedDays(NAPOJENY, YEAR, 'vacation', 3), null);
  check('a jeho zostatok sa nehol',
        (await Quota.effective(NAPOJENY, YEAR)).vacation_days_remaining, 17.5);
  // Zrkadlovo: komu sa neodpočítalo, tomu sa nemá čo vracať. Bez toho by
  // zrušenie žiadosti pridalo dni, ktoré mu appka nikdy nevzala.
  check('ani nevráti pri zrušení',
        await Quota.removeUsedDays(NAPOJENY, YEAR, 'vacation', 3), null);
  check('nenapojenému sa odpočíta',
        Number((await Quota.addUsedDays(BEZ_CISLA, YEAR, 'vacation', 3)).vacation_days_used), 7);
  check('a zostatok klesol',
        (await Quota.effective(BEZ_CISLA, YEAR)).vacation_days_remaining, 18);

  console.log('\n6. Nespracované = schválené po poslednom mesiaci v PAM');
  // Mzdy sú spracované do augusta (lastMonth = 8).
  await ziadost(NAPOJENY, 'ocr', `${YEAR}-03-10`, 8);      // marec - PAM to už videl
  await ziadost(NAPOJENY, 'ocr', `${YEAR}-09-15`, 9.54);   // september - ešte nie
  await ziadost(NAPOJENY, 'vacation', `${YEAR}-10-01`, 2); // október - ešte nie
  await ziadost(NAPOJENY, 'vacation', `${YEAR}-11-01`, 5, 'Pending'); // neschválené
  q = await Quota.effective(NAPOJENY, YEAR);
  check('sprievod: len tá septembrová', q.ocr_days_pending, 9.54);
  check('dovolenka: len tá októbrová', q.vacation_days_pending, 2);
  check('neschválené sa nepočíta', q.vacation_days_pending, 2);
  // Zostatok zostáva číslom PAM. Kolegyňa musí vidieť to isté, čo vidí v
  // PAM, inak sa to nedá porovnať - nespracované stojí vedľa.
  check('zostatok je stále číslo PAM', q.ocr_days_remaining, 48);

  console.log('\n7. Nespracované sa odpočíta pri povolení ďalšej žiadosti');
  // Zostatok 48 h, z toho 9,54 h už schválených. Reálne voľných 38,46 h.
  check('40 hodín neprejde', await Quota.hasEnoughDays(NAPOJENY, YEAR, 'ocr', 40), false);
  check('38 hodín prejde', await Quota.hasEnoughDays(NAPOJENY, YEAR, 'ocr', 38), true);
  // Nenapojený nemá čo čakať - appka mu odpočítava sama.
  check('nenapojený nemá nespracované',
        (await Quota.effective(BEZ_CISLA, YEAR)).vacation_days_pending, 0);

  console.log('\n8. Zoznam pre celú firmu dáva to isté');
  const all = await Quota.findAllByYear(YEAR);
  const pending = await Quota.pendingByUser(YEAR);
  const byId = Object.fromEntries(
    all.filter((r) => USERS.includes(r.user_id))
       .map((r) => [r.user_id, Quota.withEffectiveValues(r, pending)])
  );
  check('napojený: PAM', byId[NAPOJENY].quota_source, 'pam');
  check('napojený: rovnaký zostatok ako jednotlivo', byId[NAPOJENY].ocr_days_remaining, 48);
  check('napojený: rovnaké nespracované', byId[NAPOJENY].ocr_days_pending, 9.54);
  check('bez čísla: ručný', byId[BEZ_CISLA].quota_source, 'manual');
  check('externý: ručný', byId[EXTERNY].quota_source, 'manual');

  console.log('\n9. Štítok pri žiadosti: Spracované / Nespracované');
  const Ticket = require('../src/database/models/Ticket');
  const stav = async (userId) => (await Ticket.findAll({ createdById: userId }))
    .map((t) => `${String(t.start_date.toISOString()).slice(0, 7)} ${t.ticket_type}: ${t.pam_state}`)
    .sort();
  check('napojený', await stav(NAPOJENY), [
    `${YEAR}-03 ocr: processed`,        // marec, mzdy spracované do augusta
    `${YEAR}-09 ocr: pending`,          // september, ešte nie
    `${YEAR}-10 vacation: pending`,     // október, ešte nie
    `${YEAR}-11 vacation: null`         // neschválená - otázka sa na ňu nevzťahuje
  ]);

  // Nenapojenému sa štítok nesmie ukázať vôbec: appka mu kvótu odpočítava
  // sama, takže nemá na čo čakať a „Nespracované" by mu len klamalo.
  await ziadost(BEZ_CISLA, 'vacation', `${YEAR}-09-20`, 2);
  check('nenapojený nemá štítok', await stav(BEZ_CISLA), [`${YEAR}-09 vacation: null`]);
}

main()
  .catch((error) => { console.error(error); failures += 1; })
  .then(async () => {
    await cleanup().catch(() => {});
    await pool.end().catch(() => {});
    console.log('');
    console.log(failures
      ? `${RED}${failures} kontrol zlyhalo${OFF}\n`
      : `${GREEN}Všetko prešlo${OFF} - napojený číta z PAM, nenapojený funguje ako doteraz.\n`);
    process.exit(failures ? 1 : 0);
  });
