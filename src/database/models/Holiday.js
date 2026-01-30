const pool = require('../config');

class Holiday {
  /**
   * Get all holidays for a year
   */
  static async findByYear(year) {
    const result = await pool.query(
      'SELECT * FROM holidays WHERE year = $1 ORDER BY date',
      [year]
    );
    return result.rows;
  }

  /**
   * Check if a date is a holiday
   */
  static async isHoliday(date) {
    const result = await pool.query(
      'SELECT * FROM holidays WHERE date = $1',
      [date]
    );
    return result.rows.length > 0;
  }

  /**
   * Get holidays between two dates
   */
  static async findBetween(startDate, endDate) {
    const result = await pool.query(
      'SELECT * FROM holidays WHERE date >= $1 AND date <= $2 ORDER BY date',
      [startDate, endDate]
    );
    return result.rows;
  }

  /**
   * Count working days between two dates (excludes weekends and holidays)
   */
  static async countWorkingDays(startDate, endDate) {
    const result = await pool.query(
      `SELECT COUNT(*) as working_days
       FROM generate_series($1::date, $2::date, '1 day') d
       WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
         AND d NOT IN (SELECT date FROM holidays WHERE date >= $1 AND date <= $2)`,
      [startDate, endDate]
    );
    return parseInt(result.rows[0].working_days) || 0;
  }

  /**
   * Add a holiday
   */
  static async create(date, name, year) {
    const result = await pool.query(
      `INSERT INTO holidays (date, name, year) VALUES ($1, $2, $3)
       ON CONFLICT (date) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [date, name, year]
    );
    return result.rows[0];
  }

  /**
   * Delete a holiday
   */
  static async delete(id) {
    const result = await pool.query(
      'DELETE FROM holidays WHERE id = $1 RETURNING *',
      [id]
    );
    return result.rows[0];
  }
}

module.exports = Holiday;
