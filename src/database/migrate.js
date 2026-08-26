const fs = require('fs');
const path = require('path');
const pool = require('./config');
const { runMigrations } = require('./runMigrations');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting database migration...');

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    await client.query(schema);
    console.log('✅ Base schema applied (schema.sql)');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    client.release();
    await pool.end();
    process.exit(1);
  }

  client.release();

  // Numbered migrations. 001-023 were applied by hand before the runner existed
  // and are recorded as a baseline instead of being replayed - on a brand-new
  // database they still have to be applied manually. See runMigrations.js.
  const result = await runMigrations(pool);

  await pool.end();

  if (result.failed) {
    console.error(`❌ Migration ${result.failed.name || ''} failed: ${result.failed.error}`);
    process.exit(1);
  }

  if (result.applied.length > 0) {
    console.log(`✅ Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`);
  } else {
    console.log('✅ No pending migrations');
  }
}

if (require.main === module) {
  migrate();
}

module.exports = migrate;
