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
    const paragraphDays = defaults.rows[0]?.default_paragraph_days || 7;
    const ocrDays = defaults.rows[0]?.default_ocr_days || 7;

    result = await pool.query(
      `INSERT INTO employee_quotas (user_id, year, vacation_days_total, sick_days_total, paragraph_days_total, ocr_days_total)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, year) DO NOTHING
       RETURNING *`,
      [userId, year, vacationDays, sickDays, paragraphDays, ocrDays]
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
   * Shows ALL users, including those without quota records yet
   */
  static async findAllByYear(year) {
    // Get defaults from quota_settings
    const defaults = await pool.query(
      'SELECT * FROM quota_settings WHERE year = $1',
      [year]
    );
    const defVacation = defaults.rows[0]?.default_vacation_days || 20;
    const defSick = defaults.rows[0]?.default_sick_days || 5;
    const defParagraph = defaults.rows[0]?.default_paragraph_days || 7;
    const defOcr = defaults.rows[0]?.default_ocr_days || 7;

    const result = await pool.query(
      `SELECT
         u.user_id,
         u.display_name,
         u.email,
         COALESCE(eq.year, $1) as year,
         COALESCE(eq.vacation_days_total, $2) as vacation_days_total,
         COALESCE(eq.vacation_days_used, 0) as vacation_days_used,
         COALESCE(eq.sick_days_total, $3) as sick_days_total,
         COALESCE(eq.sick_days_used, 0) as sick_days_used,
         COALESCE(eq.paragraph_days_total, $4) as paragraph_days_total,
         COALESCE(eq.paragraph_days_used, 0) as paragraph_days_used,
         COALESCE(eq.ocr_days_total, $5) as ocr_days_total,
         COALESCE(eq.ocr_days_used, 0) as ocr_days_used,
         CASE WHEN eq.user_id IS NULL THEN true ELSE false END as needs_initialization
       FROM users u
       LEFT JOIN employee_quotas eq ON u.user_id = eq.user_id AND eq.year = $1
       WHERE COALESCE(u.hidden, false) = false
       ORDER BY u.display_name`,
      [year, defVacation, defSick, defParagraph, defOcr]
    );
    return result.rows;
  }

  /**
   * Update quota totals (admin)
   */
  static async updateTotals(userId, year, vacationTotal, sickTotal, paragraphTotal, ocrTotal) {
    const result = await pool.query(
      `UPDATE employee_quotas
       SET vacation_days_total = $1, sick_days_total = $2,
           paragraph_days_total = COALESCE($5, paragraph_days_total),
           ocr_days_total = COALESCE($6, ocr_days_total),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $3 AND year = $4
       RETURNING *`,
      [vacationTotal, sickTotal, userId, year, paragraphTotal || null, ocrTotal || null]
    );
    return result.rows[0];
  }

  /**
   * Update quota totals AND used values (admin) - for manual adjustments
   */
  static async updateQuotaFull(userId, year, data) {
    const result = await pool.query(
      `UPDATE employee_quotas
       SET vacation_days_total = COALESCE($1, vacation_days_total),
           vacation_days_used = COALESCE($2, vacation_days_used),
           paragraph_days_total = COALESCE($3, paragraph_days_total),
           paragraph_days_used = COALESCE($4, paragraph_days_used),
           ocr_days_total = COALESCE($5, ocr_days_total),
           ocr_days_used = COALESCE($6, ocr_days_used),
           sick_days_total = COALESCE($7, sick_days_total),
           sick_days_used = COALESCE($8, sick_days_used),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $9 AND year = $10
       RETURNING *`,
      [
        data.vacation_days_total,
        data.vacation_days_used,
        data.paragraph_days_total,
        data.paragraph_days_used,
        data.ocr_days_total,
        data.ocr_days_used,
        data.sick_days_total,
        data.sick_days_used,
        userId,
        year
      ]
    );
    return result.rows[0];
  }

  /**
   * Add used days (when ticket is approved)
   */
  static async addUsedDays(userId, year, type, days) {
    const columnMap = {
      'vacation': 'vacation_days_used',
      'sick-leave': 'sick_days_used',
      'paragraph': 'paragraph_days_used',
      'ocr': 'ocr_days_used'
    };
    const column = columnMap[type] || 'sick_days_used';
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
    const columnMap = {
      'vacation': 'vacation_days_used',
      'sick-leave': 'sick_days_used',
      'paragraph': 'paragraph_days_used',
      'ocr': 'ocr_days_used'
    };
    const column = columnMap[type] || 'sick_days_used';
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
    } else if (type === 'paragraph') {
      const remaining = quota.paragraph_days_total - parseFloat(quota.paragraph_days_used || 0);
      return remaining >= requestedDays;
    } else if (type === 'ocr') {
      const remaining = quota.ocr_days_total - parseFloat(quota.ocr_days_used || 0);
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
  static async upsertSettings(year, vacationDays, sickDays, carryOver = false, maxCarryOver = 0, paragraphDays = 7, ocrDays = 7) {
    const result = await pool.query(
      `INSERT INTO quota_settings (year, default_vacation_days, default_sick_days, carry_over_enabled, max_carry_over_days, default_paragraph_days, default_ocr_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (year) DO UPDATE SET
         default_vacation_days = EXCLUDED.default_vacation_days,
         default_sick_days = EXCLUDED.default_sick_days,
         carry_over_enabled = EXCLUDED.carry_over_enabled,
         max_carry_over_days = EXCLUDED.max_carry_over_days,
         default_paragraph_days = EXCLUDED.default_paragraph_days,
         default_ocr_days = EXCLUDED.default_ocr_days,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [year, vacationDays, sickDays, carryOver, maxCarryOver, paragraphDays, ocrDays]
    );
    return result.rows[0];
  }

  /**
   * Initialize quotas for all users for a given year
   * Uses quota_settings defaults, falls back to 20/5 if no settings exist
   */
  static async initializeForAllUsers(year) {
    const settings = await this.getSettings(year);
    const vacationDays = settings?.default_vacation_days || 20;
    const sickDays = settings?.default_sick_days || 5;

    const paragraphDays = settings?.default_paragraph_days || 7;
    const ocrDays = settings?.default_ocr_days || 7;

    const result = await pool.query(
      `INSERT INTO employee_quotas (user_id, year, vacation_days_total, sick_days_total, paragraph_days_total, ocr_days_total)
       SELECT u.user_id, $1, $2, $3, $4, $5
       FROM users u
       WHERE NOT EXISTS (
         SELECT 1 FROM employee_quotas eq WHERE eq.user_id = u.user_id AND eq.year = $1
       )
       RETURNING *`,
      [year, vacationDays, sickDays, paragraphDays, ocrDays]
    );
    return result.rows;
  }
}

module.exports = Quota;
