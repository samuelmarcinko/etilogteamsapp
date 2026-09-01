/**
 * Numbered migration runner.
 *
 * Applies `src/database/migrations/NNN_*.sql` in numeric order and records
 * every applied file in `schema_migrations`, so each one runs exactly once.
 *
 * Baseline
 * --------
 * Migrations 001-023 predate this runner: they were applied by hand via psql
 * (023 additionally has an idempotent top-up in src/index.js). Their execution
 * path against a live database was never exercised by any tooling, and several
 * of them are not safely repeatable. So on the very first run this module marks
 * everything up to BASELINE_THROUGH as already applied instead of executing it.
 * Only 024 and above are ever run by this code.
 *
 * That makes the first deploy a no-op on production: it creates one bookkeeping
 * table and writes 23 rows into it. Nothing in the existing schema is touched.
 *
 * Note for a brand-new database: `npm run migrate` creates the base schema, but
 * migrations 001-023 still have to be applied by hand, exactly as before. This
 * runner deliberately does not attempt to replay that history.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Highest migration number that was applied manually before this runner existed.
const BASELINE_THROUGH = 23;

// Arbitrary but fixed key, so two app instances starting at once cannot both migrate.
const ADVISORY_LOCK_KEY = 8724193;

const FILENAME_RE = /^(\d{3,})_.*\.sql$/;

/**
 * Read and sort the migration files on disk.
 * Files that do not match NNN_name.sql are ignored, as are *_down.sql rollbacks.
 */
function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => FILENAME_RE.test(name) && !name.endsWith('_down.sql'))
    .map((name) => ({ name, version: parseInt(name.match(FILENAME_RE)[1], 10) }))
    .sort((a, b) => a.version - b.version);
}

async function ensureBookkeepingTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      is_baseline BOOLEAN NOT NULL DEFAULT FALSE,
      applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Record 001-023 as applied without executing them. Runs only when the table is
 * empty, i.e. the first time this runner sees a given database.
 */
async function recordBaseline(client, files) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM schema_migrations');
  if (rows[0].count > 0) return 0;

  const baseline = files.filter((f) => f.version <= BASELINE_THROUGH);
  for (const file of baseline) {
    await client.query(
      'INSERT INTO schema_migrations (version, name, is_baseline) VALUES ($1, $2, TRUE)',
      [file.version, file.name]
    );
  }

  logger.info('Migration baseline recorded (not executed)', {
    through: BASELINE_THROUGH,
    count: baseline.length
  });
  return baseline.length;
}

// A migration that opens or closes its own transaction would end the one this
// runner wraps around it, and a later failure would no longer roll back. Reject
// it up front rather than discovering that on a broken deploy. PL/pgSQL blocks
// are unaffected: their BEGIN is never followed by a semicolon.
const TX_STATEMENT_RE = /^[ \t]*(BEGIN|COMMIT|ROLLBACK)[ \t]*;/im;

async function applyMigration(client, file) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file.name), 'utf8');

  const stray = sql.match(TX_STATEMENT_RE);
  if (stray) {
    throw new Error(
      `contains a top-level ${stray[1].toUpperCase()}; migrations must not manage ` +
      'their own transaction - the runner already wraps each file in one'
    );
  }

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
      [file.version, file.name]
    );
    await client.query('COMMIT');
    logger.info('Migration applied', { migration: file.name });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * Apply every pending migration above the baseline.
 *
 * Resolves with a summary instead of throwing on SQL failure, so a bad migration
 * cannot take the whole portal down on boot — the error is logged loudly and the
 * caller decides. Migrations run in numeric order and stop at the first failure,
 * so the schema never ends up partially ahead.
 */
async function runMigrations(pool) {
  const db = pool || require('./config');
  const applied = [];
  let client;

  try {
    // Inside the try: if the database is briefly unreachable at boot, connect()
    // rejects, and outside it that rejection would escape and kill the process.
    client = await db.connect();

    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    await ensureBookkeepingTable(client);

    const files = listMigrationFiles();
    await recordBaseline(client, files);

    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const done = new Set(rows.map((r) => r.version));

    const pending = files.filter((f) => f.version > BASELINE_THROUGH && !done.has(f.version));

    if (pending.length === 0) {
      logger.debug('No pending migrations');
      return { applied, failed: null };
    }

    for (const file of pending) {
      try {
        await applyMigration(client, file);
        applied.push(file.name);
      } catch (error) {
        logger.error('Migration failed - stopping', {
          migration: file.name,
          error: error.message
        });
        return { applied, failed: { name: file.name, error: error.message } };
      }
    }

    return { applied, failed: null };
  } catch (error) {
    logger.error('Migration runner error', { error: error.message });
    return { applied, failed: { name: null, error: error.message } };
  } finally {
    // client is undefined when connect() itself failed.
    if (client) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
      } catch (_) {
        // Connection already gone; the lock dies with the session anyway.
      }
      client.release();
    }
  }
}

module.exports = { runMigrations, listMigrationFiles, BASELINE_THROUGH };
