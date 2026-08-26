#!/usr/bin/env node
/**
 * Demo data for the production planner.
 *
 * The real plan arrives with the Excel import; this exists so the planner can
 * be clicked through before then. Everything it writes is tagged with
 * source_file = 'demo-seed', so --clear removes exactly what it added and
 * nothing else.
 *
 *   node scripts/seed-production-demo.js --location=PO1 --confirm
 *   node scripts/seed-production-demo.js --location=PO1 --clear --confirm
 *
 * --confirm is required, because this writes to whatever database DB_NAME
 * points at.
 */

const pool = require('../src/database/config');

const SOURCE_TAG = 'demo-seed';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : fallback;
};

const LOCATION_CODE = value('location', 'PO1');
const CLEAR = flag('clear');

const PRODUCTS = [
  ['FG100865', 'Outside mirror AU310 Sicherheitsgurt'],
  ['FG100735', 'Dachhimmel Cover C/X118'],
  ['FG100899', 'Seitenverkleidung B-Säule links'],
  ['FG100829', 'GLT 70A541155 Sicherheitsg. VO EBSS ESD'],
  ['FG100918', 'Türverkleidung hinten rechts'],
  ['FG101033', 'Kofferraumabdeckung W177']
];

// [dayOffset from this Monday, shiftIndex, fg | {custom}, qty, extras]
const PLAN = [
  [0, 0, 'FG100865', 30, {}],
  [0, 1, 'FG100735', 152, { parts: [130, 22], raw: '130+22' }],
  [1, 0, 'FG100899', 240, { priority: 'urgent' }],
  [1, 1, { custom: 'TESLA ABD' }, 60, { priority: 'high', notes: '*USES:\nPolybrush single: 1715 meters' }],
  [2, 0, 'FG100829', 80, {}],
  [2, 1, { custom: 'Daimler B-Säule' }, 45, {}],
  [3, 0, 'FG100865', 30, { status: 'in_progress' }],
  [3, 1, 'FG100918', 190, {}],
  [4, 0, 'FG100735', 120, {}],
  [7, 0, 'FG100829', 210, { priority: 'urgent' }],
  [7, 1, 'FG100918', 90, {}],
  [8, 0, 'FG100865', 45, {}],
  [9, 1, 'FG101033', 75, { priority: 'high' }],
  [10, 0, 'FG100735', 160, {}],
  [11, 1, 'FG100899', 140, { status: 'done' }],
  [15, 0, 'FG100829', 95, {}],
  [16, 1, 'FG100918', 110, {}],
  [17, 0, 'FG101033', 60, {}],
  [22, 0, 'FG100865', 30, {}],
  [23, 1, 'FG100735', 130, {}]
];

const FREE_DAYS = [5, 6, 12, 13, 19, 20, 26, 27];

function mondayOfThisWeek() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return monday;
}

function isoOffset(base, days) {
  const d = new Date(base);
  d.setDate(base.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  if (!flag('confirm')) {
    console.error(
      `Refusing to run without --confirm.\n` +
      `This writes demo rows into database "${process.env.DB_NAME || 'teams_approval'}".`
    );
    process.exitCode = 1;
    return;
  }

  const { rows: locRows } = await pool.query(
    'SELECT id, name FROM production_locations WHERE code = $1',
    [LOCATION_CODE]
  );
  if (!locRows[0]) {
    console.error(`Location "${LOCATION_CODE}" not found. Has migration 025 been applied?`);
    process.exitCode = 1;
    return;
  }
  const location = locRows[0];

  if (CLEAR) {
    const entries = await pool.query(
      'DELETE FROM production_plan_entries WHERE location_id = $1 AND source_file = $2',
      [location.id, SOURCE_TAG]
    );
    const flags = await pool.query(
      'DELETE FROM production_day_flags WHERE location_id = $1 AND note = $2',
      [location.id, SOURCE_TAG]
    );
    console.log(`Removed ${entries.rowCount} demo entries and ${flags.rowCount} demo day flags from ${location.name}.`);
    return;
  }

  const { rows: shifts } = await pool.query(
    'SELECT id, name FROM production_shifts WHERE location_id = $1 ORDER BY sort_order',
    [location.id]
  );
  if (shifts.length < 2) {
    console.error(`${location.name} has fewer than two shifts; nothing sensible to seed.`);
    process.exitCode = 1;
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    const monday = mondayOfThisWeek();
    let entryCount = 0;

    for (const [dayOffset, shiftIndex, product, qty, extras] of PLAN) {
      const isCustom = typeof product === 'object';
      await client.query(
        `INSERT INTO production_plan_entries
           (location_id, production_date, shift_id, product_id, custom_product_name,
            planned_quantity, quantity_breakdown, raw_quantity, priority, status, notes,
            source_file, created_by_name, updated_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Demo seed','Demo seed')`,
        [
          location.id,
          isoOffset(monday, dayOffset),
          shifts[shiftIndex].id,
          isCustom ? null : productIds[product],
          isCustom ? product.custom : null,
          qty,
          extras.parts ? JSON.stringify({ parts: extras.parts }) : null,
          extras.raw || null,
          extras.priority || 'normal',
          extras.status || 'planned',
          extras.notes || null,
          SOURCE_TAG
        ]
      );
      entryCount += 1;
    }

    for (const dayOffset of FREE_DAYS) {
      await client.query(
        `INSERT INTO production_day_flags (location_id, production_date, flag, note)
         VALUES ($1, $2, 'free', $3)
         ON CONFLICT (location_id, production_date) DO NOTHING`,
        [location.id, isoOffset(monday, dayOffset), SOURCE_TAG]
      );
    }

    await client.query('COMMIT');
    console.log(
      `Seeded ${entryCount} demo entries and ${FREE_DAYS.length} free days for ${location.name}, ` +
      `starting ${isoOffset(monday, 0)}.\n` +
      `Remove them again with: node scripts/seed-production-demo.js --location=${LOCATION_CODE} --clear --confirm`
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
