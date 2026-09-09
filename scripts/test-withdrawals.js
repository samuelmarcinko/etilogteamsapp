#!/usr/bin/env node
/**
 * Vyskladnenie - kontrola počítania proti skutočnej databáze.
 *
 *   node scripts/test-withdrawals.js
 *
 * Odpočítavanie zo skladu je to, čo sa najhoršie opravuje spätne: keď sa
 * pomýli, o týždeň už nikto nevie, koľko tam naozaj bolo. Preto sa tu prejde
 * celé - vrátane vlastných položiek, ktoré sa nesmú zmenšovať, a stornа, ktoré
 * musí vrátiť presne to, čo odpísalo.
 *
 * Skript si vyrobí vlastné riadky a na konci ich po sebe zmaže. Cudzích dát sa
 * nedotkne a proti inému než lokálnemu serveru sa odmietne spustiť - toto nie
 * je nástroj, ktorý má čo robiť v produkcii.
 */

require('dotenv').config();

const host = process.env.DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1'].includes(host) && process.env.ALLOW_REMOTE_DB !== 'yes') {
  console.error(`\nOdmietam bežať proti ${host}. Toto je test, nie nástroj na produkčné dáta.`);
  console.error('Ak naozaj treba, ALLOW_REMOTE_DB=yes - ale najprv si rozmysli prečo.\n');
  process.exit(1);
}

const pool = require('../src/database/config');
const W = require('../src/database/models/WarehouseWithdrawal');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const OFF = '\x1b[0m';

const user = { id: 'local:test-tablet', name: 'Tablet sklad' };
const made = { materials: [], locations: [], users: [] };
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

const qtyAt = async (m, l) => (await pool.query(
  'SELECT quantity FROM material_placements WHERE material_id = $1 AND location_id = $2', [m, l]
)).rows[0]?.quantity;

const total = async (m) => (await pool.query(
  'SELECT quantity FROM materials WHERE id = $1', [m]
)).rows[0]?.quantity;

async function makeLocation(code, zone, position) {
  const { rows } = await pool.query(
    'INSERT INTO pallet_locations (code, zone, position) VALUES ($1, $2, $3) RETURNING id',
    [code, zone, position]
  );
  made.locations.push(rows[0].id);
  return rows[0].id;
}

async function makeMaterial(code, name, kind, places) {
  const { rows } = await pool.query(
    `INSERT INTO materials (code, name, kind, unit, quantity, sap_item_code)
     VALUES ($1, $2, $3, 'ks', $4, $5) RETURNING id`,
    [code, name, kind, places.reduce((s, p) => s + p[1], 0), kind === 'sap' ? code : null]
  );
  made.materials.push(rows[0].id);
  for (const [locationId, quantity] of places) {
    await pool.query(
      'INSERT INTO material_placements (material_id, location_id, quantity) VALUES ($1, $2, $3)',
      [rows[0].id, locationId, quantity]
    );
  }
  return rows[0].id;
}

async function cleanup() {
  if (made.materials.length) {
    await pool.query('DELETE FROM warehouse_withdrawals WHERE material_id = ANY($1)', [made.materials]);
    await pool.query('DELETE FROM material_placements WHERE material_id = ANY($1)', [made.materials]);
    await pool.query('DELETE FROM materials WHERE id = ANY($1)', [made.materials]);
  }
  if (made.locations.length) {
    await pool.query('DELETE FROM pallet_locations WHERE id = ANY($1)', [made.locations]);
  }
  if (made.users.length) {
    await pool.query('DELETE FROM users WHERE user_id = ANY($1)', [made.users]);
  }
}

async function main() {
  // Kódy sú zámerne nezmyselné, aby sa nedali zameniť so skutočným materiálom
  // ani vtedy, keby po sebe upratanie z nejakého dôvodu neprebehlo.
  const b1 = await makeLocation('ZZ-TEST-1', 'C', 901);
  const b4 = await makeLocation('ZZ-TEST-2', 'C', 902);

  const sapMat = await makeMaterial('ZZTEST-RM1', 'Testovací kartón', 'sap', [[b1, 120], [b4, 34]]);
  const locMat = await makeMaterial(null, 'Testovacie tašky', 'local', [[b1, 1]]);

  console.log('\n1. Hľadanie v evidencii');
  const byCode = await W.search('ZZTEST-RM1');
  check('kód nájde položku', byCode.length, 1);
  check('vráti obe pozície', byCode[0].placements.length, 2);
  check('vlastnú položku nájde názov (kód nemá)', (await W.search('Testovacie tašky')).length, 1);
  check('jedno písmeno nehľadá', (await W.search('t')).length, 0);

  console.log('\n2. Výdaj položky zo SAPu');
  const first = await W.create({ materialId: sapMat, locationId: b1, quantity: 20, user });
  check('zapísalo sa', first.withdrawal.quantity, 20);
  check('pozícia klesla', await qtyAt(sapMat, b1), 100);
  check('druhá pozícia sa nezmenila', await qtyAt(sapMat, b4), 34);
  check('celkové množstvo kleslo', await total(sapMat), 134);
  check('stav pred a po je zapísaný',
        [first.withdrawal.quantity_before, first.withdrawal.quantity_after], [120, 100]);

  console.log('\n3. Viac, než na pozícii je');
  const tooMuch = await W.create({ materialId: sapMat, locationId: b1, quantity: 500, user });
  check('odmietne to', tooMuch.error, 'not_enough');
  check('povie, koľko tam je', tooMuch.available, 100);
  check('počet zostal nedotknutý', await qtyAt(sapMat, b1), 100);

  console.log('\n4. Vlastná položka - počet je len poznámka skladníka');
  const bags = await W.create({ materialId: locMat, locationId: b1, quantity: 15, user });
  check('výdaj prejde aj nad zapísaný "1 ks"', bags.withdrawal.quantity, 15);
  check('počet na pozícii sa nezmenil', await qtyAt(locMat, b1), 1);
  check('celkové množstvo sa nezmenilo', await total(locMat), 1);
  check('v zázname stojí, že sa počtu nedotklo', bags.withdrawal.quantity_touched, false);

  console.log('\n5. Storno');
  const voided = await W.void(first.withdrawal.id, { id: 'u:sklad', name: 'Skladník' }, 'omyl');
  check('stav je stornované', voided.withdrawal.status, 'voided');
  check('počet sa vrátil na pozíciu', await qtyAt(sapMat, b1), 120);
  check('celkové množstvo sa vrátilo', await total(sapMat), 154);
  check('druhýkrát sa stornovať nedá', (await W.void(first.withdrawal.id, user, null)).error, 'already_voided');
  const bagsVoid = await W.void(bags.withdrawal.id, user, 'aj tašky');
  check('storno vlastnej položky prejde', bagsVoid.withdrawal.status, 'voided');
  check('a počet nechá tak', await qtyAt(locMat, b1), 1);

  console.log('\n6. Čo neprejde vôbec');
  check('nula', (await W.create({ materialId: sapMat, locationId: b1, quantity: 0, user })).error, 'bad_quantity');
  check('záporné množstvo', (await W.create({ materialId: sapMat, locationId: b1, quantity: -5, user })).error, 'bad_quantity');
  check('pozícia, na ktorej materiál nie je',
        (await W.create({ materialId: locMat, locationId: b4, quantity: 1, user })).error, 'placement_not_found');

  console.log('\n7. Lišta pre skladníka');
  made.users.push('local:test-skladnik');
  await pool.query(
    `INSERT INTO users (user_id, email, display_name, role, auth_provider)
     VALUES ('local:test-skladnik', 'zztest@etilog.local', 'Testovací skladník', 'sklad', 'local')`
  );
  // Lišta je zámerne globálna - skladník má vidieť každý výdaj, nie len ten
  // svoj - takže sa tu počítajú rozdiely oproti tomu, čo v sklade už bolo.
  const seen = async () => (await W.newSince('local:test-skladnik')).length;
  const base = await seen();
  await W.create({ materialId: sapMat, locationId: b4, quantity: 5, user });
  check('nový výdaj sa ohlási', (await seen()) - base, 1);
  await W.markSeen('local:test-skladnik');
  check('po odkliknutí je ticho', await seen(), 0);
  const later = await W.create({ materialId: sapMat, locationId: b4, quantity: 4, user });
  check('ďalší výdaj sa ohlási znova', await seen(), 1);
  await W.void(later.withdrawal.id, user, 'omyl');
  check('stornovaný už neotravuje', await seen(), 0);

  console.log('\n8. História');
  const mine = await W.findAll({ search: 'ZZ' });
  check('drží všetko vrátane stornovaných', mine.length, 4);
  check('od najnovšieho', mine[0].quantity, 4);
  check('filter podľa stavu', (await W.findAll({ search: 'ZZ', status: 'voided' })).length, 3);
  check('filter podľa pozície', (await W.findAll({ search: 'ZZ-TEST-2' })).length, 2);
  const today = new Date().toISOString().slice(0, 10);
  check('dnešok nájde dnešné výdaje', (await W.findAll({ search: 'ZZ', from: today, to: today })).length, 4);
}

main()
  .catch((error) => { console.error(error); failures += 1; })
  .then(cleanup)
  .then(() => {
    console.log('');
    console.log(failures
      ? `${RED}${failures} kontrol zlyhalo${OFF} - takto sa sklad nasadiť nedá.\n`
      : `${GREEN}Všetko prešlo${OFF} - počty sedia a po teste nezostali žiadne dáta.\n`);
    process.exitCode = failures ? 1 : 0;
  })
  .finally(() => pool.end());
