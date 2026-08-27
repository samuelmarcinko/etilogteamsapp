#!/usr/bin/env node
/**
 * Demo data for the production planner.
 *
 * The real plan arrives with the Excel import; this exists so the planner can
 * be exercised properly before then - which means it has to look like real
 * production, not like three tidy cards. It seeds several locations at once,
 * weeks either side of today, uneven density, multi-card slots, free weekends,
 * an important day, custom free-text production, quantity breakdowns, notes, and
 * a queue with an overdue item.
 *
 *   node scripts/seed-production-demo.js --confirm
 *   node scripts/seed-production-demo.js --confirm --locations=PO1,DS1 --weeks=8
 *   node scripts/seed-production-demo.js --confirm --clear
 *
 * Everything it writes is tagged source_file = 'demo-seed', so --clear removes
 * exactly what it added and nothing a person entered by hand.
 *
 * --confirm is required, because this writes to whatever DB_NAME points at.
 */

const pool = require('../src/database/config');

const SOURCE_TAG = 'demo-seed';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : fallback;
};

const LOCATION_CODES = value('locations', 'PO1,DS1,KANDRAC,MIRAND1').split(',').map((c) => c.trim());
const WEEKS_AHEAD = Number(value('weeks', 6));
const WEEKS_BEHIND = Number(value('weeksBehind', 2));
const CLEAR = flag('clear');

// ---------------------------------------------------------------- catalogue
const PRODUCTS = [
  ['FG100865', 'Outside mirror AU310 Sicherheitsgurt'],
  ['FG100735', 'Dachhimmel Cover C/X118'],
  ['FG100899', 'Seitenverkleidung B-Säule links'],
  ['FG100829', 'GLT 70A541155 Sicherheitsg. VO EBSS ESD'],
  ['FG100918', 'Türverkleidung hinten rechts'],
  ['FG101033', 'Kofferraumabdeckung W177'],
  ['FG101204', 'Dachhimmel Prototyp – Vorserie'],
  ['FG100412', 'Ablagefach Mittelkonsole'],
  ['FG101580', 'Hutablage Verkleidung V297'],
  ['FG100277', 'Sonnenblende Halter links']
];

// Free-text production is common in the sheets, so the demo has to include it.
const CUSTOM_PRODUCTS = [
  'TESLA ABD',
  'Daimler B-Säule',
  'Blocker Daimler Gefacheumbau',
  'C/X118 Dachh. Cover Sonderlauf'
];

const NOTES = [
  '*USES:\nPolybrush single: 1715 meters',
  'Material dorazí až v stredu ráno',
  'Kontrola kvality – 100 % vizuál',
  'Nová šarža lepidla, sledovať priľnavosť',
  'Zákazník potvrdil odchýlku rozmeru'
];

/**
 * Deterministic pseudo-random, so re-seeding gives the same plan and two people
 * comparing notes are looking at the same thing.
 */
function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function mondayOfThisWeek() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(12, 0, 0, 0); // midday, so a timezone shift cannot move the date
  return monday;
}

function isoOffset(base, days) {
  const d = new Date(base);
  d.setDate(base.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function clearLocation(client, location) {
  const entries = await client.query(
    'DELETE FROM production_plan_entries WHERE location_id = $1 AND source_file = $2',
    [location.id, SOURCE_TAG]
  );
  const flags = await client.query(
    'DELETE FROM production_day_flags WHERE location_id = $1 AND note = $2',
    [location.id, SOURCE_TAG]
  );
  await client.query(
    "DELETE FROM production_change_log WHERE location_id = $1 AND changed_by = 'demo-seed'",
    [location.id]
  );
  return { entries: entries.rowCount, flags: flags.rowCount };
}

async function seedLocation(client, location, productIds, index) {
  // Each location gets its own stream, so they do not all look identical.
  const random = makeRandom(1000 + index * 977);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const monday = mondayOfThisWeek();

  let entries = 0;
  let flags = 0;

  const { rows: shifts } = await client.query(
    'SELECT id, name FROM production_shifts WHERE location_id = $1 ORDER BY sort_order',
    [location.id]
  );
  if (shifts.length < 2) return { entries: 0, flags: 0, skipped: 'fewer than two shifts' };

  const firstDay = -WEEKS_BEHIND * 7;
  const lastDay = WEEKS_AHEAD * 7 - 1;

  for (let day = firstDay; day <= lastDay; day++) {
    const date = isoOffset(monday, day);
    const weekday = ((day % 7) + 7) % 7; // 0 = Monday
    const isWeekend = weekday >= 5;
    const weeksOut = Math.floor(day / 7);

    // Weekends are free, except the occasional Saturday shift - the real sheets
    // have Saturday production, so "weekend = off" would be a lie.
    const saturdayShift = weekday === 5 && random() < 0.25;
    if (isWeekend && !saturdayShift) {
      await client.query(
        `INSERT INTO production_day_flags (location_id, production_date, flag, note)
         VALUES ($1, $2, 'free', $3)
         ON CONFLICT (location_id, production_date) DO NOTHING`,
        [location.id, date, SOURCE_TAG]
      );
      flags += 1;
      continue;
    }

    // One important day a fortnight or so, to exercise the day-flag rendering.
    if (!isWeekend && random() < 0.04) {
      await client.query(
        `INSERT INTO production_day_flags (location_id, production_date, flag, note)
         VALUES ($1, $2, 'important', $3)
         ON CONFLICT (location_id, production_date) DO NOTHING`,
        [location.id, date, SOURCE_TAG]
      );
      flags += 1;
    }

    // Planning thins out the further ahead you look, which is what makes the
    // multi-week view worth having.
    const fillChance = weeksOut <= 0 ? 0.92 : weeksOut <= 2 ? 0.75 : weeksOut <= 4 ? 0.45 : 0.2;

    for (const [shiftIndex, shift] of shifts.entries()) {
      if (random() > fillChance) continue;
      // Afternoons are lighter than mornings.
      if (shiftIndex > 0 && random() < 0.3) continue;

      // Occasionally two cards in one slot - the historical data does this and
      // the UI must not assume otherwise.
      const cards = random() < 0.12 ? 2 : 1;

      for (let c = 0; c < cards; c++) {
        const useCustom = random() < 0.15;
        const fg = pick(PRODUCTS)[0];

        const roll = random();
        // Two priorities since migration 028; the rest of the variety comes
        // from the colours a planner would put on related work.
        const priority = roll < 0.06 ? 'urgent' : 'normal';
        const color = priority === 'urgent' ? null
          : roll < 0.16 ? 'orange' : roll < 0.24 ? 'teal' : roll < 0.3 ? 'violet' : null;

        // Past days are finished; today and ahead are planned. Two statuses
        // only, since migration 029.
        const status = day < 0 ? 'done' : 'planned';

        // A whole number of pieces, always: the "130+22" cells the Excel sheet
        // carried are gone, and two deliveries are two cards.
        const quantity = 20 + Math.floor(random() * 160);

        await client.query(
          `INSERT INTO production_plan_entries
             (location_id, production_date, shift_id, product_id, custom_product_name,
              planned_quantity, priority, color, status, notes,
              sort_order, source_file, created_by, created_by_name, updated_by, updated_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'demo-seed','Demo seed','demo-seed','Demo seed')`,
          [
            location.id,
            date,
            shift.id,
            useCustom ? null : productIds[fg],
            useCustom ? pick(CUSTOM_PRODUCTS) : null,
            quantity,
            priority,
            color,
            status,
            random() < 0.1 ? pick(NOTES) : null,
            c,
            SOURCE_TAG
          ]
        );
        entries += 1;
      }
    }
  }

  // A queue with something already overdue, so the badge has a reason to show.
  const queue = [
    { fg: 'FG100735', qty: 250, due: isoOffset(monday, 5), priority: 'normal', color: 'orange' },
    { fg: 'FG100829', qty: 80, due: isoOffset(monday, 12), priority: 'normal', color: 'teal' },
    { custom: 'TESLA ABD', qty: 40, due: isoOffset(monday, -3), priority: 'urgent', color: null },
    { fg: 'FG101580', qty: 120, due: null, priority: 'normal', color: null }
  ];

  for (const [i, item] of queue.entries()) {
    await client.query(
      `INSERT INTO production_plan_entries
         (location_id, production_date, shift_id, product_id, custom_product_name,
          planned_quantity, priority, color, status, due_date, sort_order, source_file,
          created_by, created_by_name, updated_by, updated_by_name)
       VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, 'planned', $7, $8, $9,
               'demo-seed','Demo seed','demo-seed','Demo seed')`,
      [
        location.id,
        item.fg ? productIds[item.fg] : null,
        item.custom || null,
        item.qty,
        item.priority,
        item.color,
        item.due,
        i,
        SOURCE_TAG
      ]
    );
    entries += 1;
  }

  return { entries, flags };
}

async function main() {
  if (!flag('confirm')) {
    console.error(
      'Refusing to run without --confirm.\n' +
      `This writes demo rows into database "${process.env.DB_NAME || 'teams_approval'}".`
    );
    process.exitCode = 1;
    return;
  }

  const { rows: locations } = await pool.query(
    'SELECT id, code, name FROM production_locations WHERE code = ANY($1::text[]) ORDER BY sort_order',
    [LOCATION_CODES]
  );

  if (!locations.length) {
    console.error(
      `None of these locations exist: ${LOCATION_CODES.join(', ')}. Has migration 025 been applied?`
    );
    process.exitCode = 1;
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (CLEAR) {
      let entries = 0;
      let flags = 0;
      for (const location of locations) {
        const removed = await clearLocation(client, location);
        entries += removed.entries;
        flags += removed.flags;
      }
      await client.query('COMMIT');
      console.log(`Removed ${entries} demo entries and ${flags} demo day flags from ${locations.length} location(s).`);
      return;
    }

    const productIds = {};
    for (const [fg, description] of PRODUCTS) {
      const { rows } = await client.query(
        `INSERT INTO products (fg_number, description) VALUES ($1, $2)
         ON CONFLICT (fg_number) DO UPDATE SET description = EXCLUDED.description
         RETURNING id`,
        [fg, description]
      );
      productIds[fg] = rows[0].id;
    }

    let total = 0;
    for (const [i, location] of locations.entries()) {
      // Re-seeding replaces rather than stacks, so running this twice does not
      // bury the grid in duplicates.
      await clearLocation(client, location);
      const result = await seedLocation(client, location, productIds, i);

      if (result.skipped) {
        console.log(`  ${location.name.padEnd(12)} skipped - ${result.skipped}`);
        continue;
      }
      console.log(`  ${location.name.padEnd(12)} ${String(result.entries).padStart(4)} entries, ${result.flags} day flags`);
      total += result.entries;
    }

    await client.query('COMMIT');

    const monday = mondayOfThisWeek();
    console.log(
      `\n${total} demo entries across ${locations.length} location(s), ` +
      `${isoOffset(monday, -WEEKS_BEHIND * 7)} to ${isoOffset(monday, WEEKS_AHEAD * 7 - 1)}.\n` +
      `Remove them again with: node scripts/seed-production-demo.js --confirm --clear` +
      (LOCATION_CODES.length ? ` --locations=${LOCATION_CODES.join(',')}` : '')
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error('Demo seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
