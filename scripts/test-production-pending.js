#!/usr/bin/env node
/**
 * Výrobný plán - nezverejnené zmeny naprieč celým plánom.
 *
 *   node scripts/test-production-pending.js
 *
 * Lišta "nezverejnené zmeny" sa kedysi pýtala len na týždne, ktoré boli práve
 * na obrazovke. Kto zmazal kartu a listol o mesiac ďalej, lištu prestal vidieť -
 * a s ňou aj tlačidlá Publish a Discard. Zmena pritom nikam nezmizla.
 *
 * Skript si vyrobí vlastnú prevádzku aj karty a na konci ich po sebe zmaže.
 * Proti inému než lokálnemu serveru sa odmietne spustiť.
 */

require('dotenv').config();

const dbHost = process.env.DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1'].includes(dbHost) && process.env.ALLOW_REMOTE_DB !== 'yes') {
  console.error(`\nOdmietam bežať proti ${dbHost}. Toto je test, nie nástroj na produkčné dáta.\n`);
  process.exit(1);
}

process.env.LOG_LEVEL = 'error';

const pool = require('../src/database/config');
const R = require('../src/database/models/ProductionRevision');

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

async function main() {
  const { rows: loc } = await pool.query(
    `INSERT INTO production_locations (code, name) VALUES ('ZZTEST', 'Test')
     ON CONFLICT (code) DO UPDATE SET name = 'Test' RETURNING id`);
  const locationId = loc[0].id;
  const { rows: sh } = await pool.query(
    `INSERT INTO production_shifts (location_id, name, sort_order) VALUES ($1, 'Ranná', 1)
     RETURNING id`, [locationId]);
  const shiftId = sh[0].id;

  const add = async (date) => (await pool.query(
    `INSERT INTO production_plan_entries (location_id, production_date, shift_id, custom_product_name, planned_quantity)
     VALUES ($1, $2, $3, 'Test', 10) RETURNING id`, [locationId, date, shiftId])).rows[0].id;

  // Dva týždne ďaleko od seba: jeden "na obrazovke", druhý o mesiac ďalej.
  const blizky = '2026-08-17';   // pondelok
  const daleky = '2026-09-21';   // pondelok, o päť týždňov
  const a = await add(blizky);
  const b = await add(daleky);

  console.log('\n1. Bez rozsahu vidí celý plán');
  const all = await R.findPending(locationId);
  check('nájde oba týždne', all.map(w => w.weekStart).sort(), [blizky, daleky]);

  console.log('\n2. S rozsahom vidí len rozsah (to, čo robil doteraz)');
  const narrow = await R.findPending(locationId, blizky, '2026-08-23');
  check('nájde len ten jeden', narrow.map(w => w.weekStart), [blizky]);

  console.log('\n3. Zverejnenie jedného týždňa neumlčí druhý');
  await R.publish(locationId, [blizky], { id: 'u', name: 'Test' });
  const afterPublish = await R.findPending(locationId);
  check('zostáva ten vzdialený', afterPublish.map(w => w.weekStart), [daleky]);

  console.log('\n4. Zmazanie karty v zverejnenom týždni sa ohlási');
  await pool.query('UPDATE production_plan_entries SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [a]);
  const afterDelete = await R.findPending(locationId);
  check('týždeň so zmazanou kartou je späť', afterDelete.map(w => w.weekStart).sort(), [blizky, daleky]);

  console.log('\n5. Dávkové načítanie dáva to isté, čo po jednom');
  const batch = await R.buildSnapshots(locationId, [blizky, daleky]);
  const one = await R.buildSnapshot(locationId, daleky);
  check('rovnaká snímka', JSON.stringify(batch[daleky]), JSON.stringify(one));
  check('karty sa nepomiešali medzi týždne',
        [batch[blizky].entries.length, batch[daleky].entries.length], [0, 1]);

  // upratanie
  await pool.query('DELETE FROM production_plan_revisions WHERE location_id = $1', [locationId]);
  await pool.query('DELETE FROM production_plan_entries WHERE location_id = $1', [locationId]);
  await pool.query('DELETE FROM production_shifts WHERE location_id = $1', [locationId]);
  await pool.query('DELETE FROM production_locations WHERE id = $1', [locationId]);

  console.log(failures
    ? `\n${RED}${failures} kontrol zlyhalo${OFF}\n`
    : `\n${GREEN}Všetko prešlo${OFF} - lištu vidno z každého pohľadu.\n`);
  process.exitCode = failures ? 1 : 0;
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
