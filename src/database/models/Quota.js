const pool = require('../config');

class Quota {
  /**
   * Get or create quota for a user/year
   */
  static async getOrCreate(userId, year) {
    // First try to find existing
    let result = await pool.query(
      'SELECT * FROM employee_quotas WHERE user_id = $1 AND year = $2',
      [userId, year]
    );

    if (result.rows[0]) {
      return result.rows[0];
    }

    // Get defaults from quota_settings
    const defaults = await pool.query(
      'SELECT * FROM quota_settings WHERE year = $1',
      [year]
    );

    const vacationDays = defaults.rows[0]?.default_vacation_days || 20;
    const sickDays = defaults.rows[0]?.default_sick_days || 5;

    result = await pool.query(
      `INSERT INTO employee_quotas (user_id, year, vacation_days_total, sick_days_total)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, year) DO NOTHING
       RETURNING *`,
      [userId, year, vacationDays, sickDays]
    );

    // In case of race condition, re-fetch
    if (!result.rows[0]) {
      result = await pool.query(
        'SELECT * FROM employee_quotas WHERE user_id = $1 AND year = $2',
        [userId, year]
      );
    }

    return result.rows[0];
  }

  /**
   * Get quota for user/year
   */
  static async findByUserAndYear(userId, year) {
    const result = await pool.query(
      'SELECT * FROM employee_quotas WHERE user_id = $1 AND year = $2',
      [userId, year]
    );
    return result.rows[0];
  }

  /**
   * Get all quotas for a year (admin view)
   */
  static async findAllByYear(year) {
    const result = await pool.query(
      `SELECT eq.*, u.display_name, u.email
       FROM employee_quotas eq
       LEFT JOIN users u ON eq.user_id = u.user_id
       WHERE eq.year = $1
       ORDER BY u.display_name`,
      [year]
    );
    return result.rows;
  }

  /**
   * Update quota totals (admin)
   */
  static async updateTotals(userId, year, vacationTotal, sickTotal) {
    const result = await pool.query(
      `UPDATE employee_quotas
       SET vacation_days_total = $1, sick_days_total = $2, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $3 AND year = $4
       RETURNING *`,
      [vacationTotal, sickTotal, userId, year]
    );
    return result.rows[0];
  }

  /**
   * Add used days (when ticket is approved)
   */
  static async addUsedDays(userId, year, type, days) {
    const column = type === 'vacation' ? 'vacation_days_used' : 'sick_days_used';
    const result = await pool.query(
      `UPDATE employee_quotas
       SET ${column} = ${column} + $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND year = $3
       RETURNING *`,
      [days, userId, year]
    );
    return result.rows[0];
  }

  /**
   * Remove used days (when ticket is rejected/cancelled after approval)
   */
  static async removeUsedDays(userId, year, type, days) {
    const column = type === 'vacation' ? 'vacation_days_used' : 'sick_days_used';
    const result = await pool.query(
      `UPDATE employee_quotas
       SET ${column} = GREATEST(${column} - $1, 0), updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND year = $3
       RETURNING *`,
      [days, userId, year]
    );
    return result.rows[0];
  }

  /**
   * Check if user has enough days
   */
  static async hasEnoughDays(userId, year, type, requestedDays) {
    const quota = await this.getOrCreate(userId, year);
    if (!quota) return false;

    if (type === 'vacation') {
      const remaining = quota.vacation_days_total - parseFloat(quota.vacation_days_used);
      return remaining >= requestedDays;
    } else if (type === 'sick-leave') {
      const remaining = quota.sick_days_total - parseFloat(quota.sick_days_used);
      return remaining >= requestedDays;
    }

    return true; // Other types don't need quota check
  }

  // --- Quota Settings ---

  /**
   * Get quota settings for a year
   */
  static async getSettings(year) {
    const result = await pool.query(
      'SELECT * FROM quota_settings WHERE year = $1',
      [year]
    );
    return result.rows[0];
  }

  /**
   * Get all quota settings
   */
  static async getAllSettings() {
    const result = await pool.query(
      'SELECT * FROM quota_settings ORDER BY year DESC'
    );
    return result.rows;
  }

  /**
   * Upsert quota settings
   */
  static async upsertSettings(year, vacationDays, sickDays, carryOver = false, maxCarryOver = 0) {
    const result = await pool.query(
      `INSERT INTO quota_settings (year, default_vacation_days, default_sick_days, carry_over_enabled, max_carry_over_days)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (year) DO UPDATE SET
         default_vacation_days = EXCLUDED.default_vacation_days,
         default_sick_days = EXCLUDED.default_sick_days,
         carry_over_enabled = EXCLUDED.carry_over_enabled,
         max_carry_over_days = EXCLUDED.max_carry_over_days,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [year, vacationDays, sickDays, carryOver, maxCarryOver]
    );
    return result.rows[0];
  }

  /**
   * Initialize quotas for all users for a given year
   */
  static async initializeForAllUsers(year) {
    const settings = await this.getSettings(year);
    if (!settings) return [];

    const result = await pool.query(
      `INSERT INTO employee_quotas (user_id, year, vacation_days_total, sick_days_total)
       SELECT u.user_id, $1, $2, $3
       FROM users u
       WHERE NOT EXISTS (
         SELECT 1 FROM employee_quotas eq WHERE eq.user_id = u.user_id AND eq.year = $1
       )
       RETURNING *`,
      [year, settings.default_vacation_days, settings.default_sick_days]
    );
    return result.rows;
  }
}

module.exports = Quota;
