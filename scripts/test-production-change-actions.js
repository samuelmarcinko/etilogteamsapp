#!/usr/bin/env node
/**
 * Denník zmien prijme každú akciu, ktorú appka zapisuje.
 *
 *   node scripts/test-production-change-actions.js
 *
 * Toto tu je kvôli jednej chybe, ktorá sa dostala do prevádzky a vydržala tam.
 * Migrácia 034 pridávala do obmedzenia `chk_change_action` dve hodnoty,
 * obmedzenie prepísala nanovo - a zoznam opísala z migrácie 026 namiesto 027.
 * Z povolených hodnôt tým vypadli `shift_note_set` a `shift_note_cleared`.
 *
 * Zápis do denníka ide v tej istej transakcii ako samotná zmena, takže sa
 * poznámka k smene prestala dať uložiť vôbec: databáza zhodila celú
 * transakciu a plánovač dostal na obrazovku hlášku o porušenom obmedzení.
 * Nespadlo nič iné, žiadny test to nechytil a prišlo sa na to tak, že to
 * niekto skúsil použiť.
 *
 * Preto sa tu neporovnávajú zoznamy ako text, ale každá hodnota sa naozaj
 * zapíše do skutočnej databázy. Keď ďalšia migrácia na niektorú zabudne,
 * spadne to tu.
 *
 * Skript po sebe upratuje. Proti inému než lokálnemu serveru sa odmietne
 * spustiť.
 */

require('dotenv').config();

const dbHost = process.env.DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1'].includes(dbHost) && process.env.ALLOW_REMOTE_DB !== 'yes') {
  console.error(`\nOdmietam bežať proti ${dbHost}. Toto je test, nie nástroj na produkčné dáta.\n`);
  process.exit(1);
}

process.env.LOG_LEVEL = 'error';

const pool = require('../src/database/config');
const { CHANGE_ACTIONS } = require('../src/database/models/changeActions');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? `${GREEN}OK${OFF}  ` : `${RED}FAIL${OFF}`} ${label}` +
              (ok ? '' : `  čakalo ${JSON.stringify(expected)}, prišlo ${JSON.stringify(actual)}`));
  if (!ok) failures += 1;
};

const CODE = 'ZZACT';

async function cleanup() {
  await pool.query('DELETE FROM production_locations WHERE code = $1', [CODE]);
}

async function main() {
  await cleanup();

  const { rows: [location] } = await pool.query(
    `INSERT INTO production_locations (code, name, is_internal, is_active, sort_order)
     VALUES ($1, 'Denník zmien (test)', TRUE, TRUE, 9100) RETURNING id`, [CODE]);

  console.log(`\n${DIM}  ${CHANGE_ACTIONS.length} akcií, každá sa naozaj zapíše${OFF}`);
  console.log('\n1. Databáza prijme každú akciu, ktorú kód pozná');

  const rejected = [];
  for (const action of CHANGE_ACTIONS) {
    try {
      await pool.query(
        `INSERT INTO production_change_log (location_id, action, summary, changed_by)
         VALUES ($1, $2, 'test', 'zz-test')`,
        [location.id, action]
      );
    } catch (error) {
      rejected.push(`${action}: ${error.message.split('\n')[0]}`);
    }
  }
  check('žiadna neodmietnutá', rejected, []);

  console.log('\n2. A naopak nepustí hocičo');
  let accepted = false;
  try {
    await pool.query(
      `INSERT INTO production_change_log (location_id, action, summary, changed_by)
       VALUES ($1, 'vymyslena_akcia', 'test', 'zz-test')`,
      [location.id]
    );
    accepted = true;
  } catch {
    // presne to sa má stať
  }
  check('vymyslená hodnota neprejde', accepted, false);

  console.log('\n3. Poznámka k smene prejde celá, nielen jej zápis do denníka');
  const ProductionEntry = require('../src/database/models/ProductionEntry');
  const { rows: [shift] } = await pool.query(
    `INSERT INTO production_shifts (location_id, name, sort_order)
     VALUES ($1, 'Morning', 10) RETURNING id`, [location.id]);

  // Časť 1 vyššie tie isté akcie do denníka už zapísala priamo, tak sa ďalej
  // pozeráme len na to, čo pribudne odteraz.
  const { rows: [{ mark }] } = await pool.query(
    'SELECT COALESCE(MAX(id), 0) AS mark FROM production_change_log WHERE location_id = $1',
    [location.id]
  );

  const user = { id: 'zz-test', name: 'Test' };
  const DAY = '2026-11-23';

  // Toto je presne tá cesta, ktorá v prevádzke padala - poznámka aj jej zápis
  // do denníka v jednej transakcii.
  let saveError = null;
  try {
    await ProductionEntry.setShiftNote(location.id, DAY, shift.id, 'ranná: odstávka linky', user);
  } catch (error) {
    saveError = error.message.split('\n')[0];
  }
  check('uloženie poznámky nespadne', saveError, null);

  const { rows: saved } = await pool.query(
    'SELECT note FROM production_shift_notes WHERE location_id = $1 AND production_date = $2',
    [location.id, DAY]
  );
  check('a poznámka je v databáze', saved[0]?.note, 'ranná: odstávka linky');

  let clearError = null;
  try {
    await ProductionEntry.setShiftNote(location.id, DAY, shift.id, '', user);
  } catch (error) {
    clearError = error.message.split('\n')[0];
  }
  check('zmazanie poznámky tiež nespadne', clearError, null);

  const { rows: logged } = await pool.query(
    `SELECT action FROM production_change_log
      WHERE location_id = $1 AND id > $2 ORDER BY id`, [location.id, mark]);
  check('obe sa zapísali do denníka',
        logged.map((r) => r.action), ['shift_note_set', 'shift_note_cleared']);
}

main()
  .catch((error) => { console.error(error); failures += 1; })
  .then(async () => {
    await cleanup().catch(() => {});
    await pool.end().catch(() => {});
    console.log('');
    console.log(failures
      ? `${RED}${failures} kontrol zlyhalo${OFF}\n`
      : `${GREEN}Všetko prešlo${OFF} - denník prijme všetko, čo doň appka píše.\n`);
    process.exit(failures ? 1 : 0);
  });
