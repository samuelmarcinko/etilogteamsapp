const pool = require('../config');

const SystemSettings = {
  async get(key) {
    const res = await pool.query('SELECT value FROM system_settings WHERE key = $1', [key]);
    return res.rows[0]?.value ?? null;
  },

  async getByPrefix(prefix) {
    const res = await pool.query(
      'SELECT key, value FROM system_settings WHERE key LIKE $1 ORDER BY key',
      [prefix + '%']
    );
    const result = {};
    for (const row of res.rows) {
      result[row.key] = row.value;
    }
    return result;
  },

  async set(key, value) {
    await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    );
  },

  async setMany(data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of Object.entries(data)) {
        await client.query(
          `INSERT INTO system_settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [key, value]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
};

module.exports = SystemSettings;
