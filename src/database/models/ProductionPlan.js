const pool = require('../config');

/**
 * Production plan data access (migration 025).
 *
 * Raw parametrised SQL through the pg pool, same as the warehouse models.
 */
class ProductionPlan {
  // ---------------------------------------------------------------- locations
  static async findLocations({ includeInactive = false } = {}) {
    const { rows } = await pool.query(
      `SELECT id, code, name, is_internal, is_active, sort_order,
              line_name, headcount, gross_hours, net_hours, supervisor
         FROM production_locations
        WHERE ($1::boolean OR is_active)
        ORDER BY sort_order, name`,
      [includeInactive]
    );
    return rows;
  }

  static async findLocationByCode(code) {
    const { rows } = await pool.query(
      'SELECT * FROM production_locations WHERE code = $1',
      [code]
    );
    return rows[0];
  }

  // ------------------------------------------------------------------- shifts
  static async findShifts(locationId) {
    const { rows } = await pool.query(
      `SELECT id, location_id, name, sort_order, is_active
         FROM production_shifts
        WHERE location_id = $1 AND is_active
        ORDER BY sort_order, name`,
      [locationId]
    );
    return rows;
  }

  // ------------------------------------------------------------------ entries
  /**
   * Every plan entry for one location across a date range, newest revision of
   * the truth: soft-deleted rows are excluded.
   *
   * Returns flat rows; the caller groups them by date and shift. Grouping here
   * would mean inventing a shape the grid may not want.
   */
  static async findEntries(locationId, fromDate, toDate) {
    const { rows } = await pool.query(
      `SELECT e.id,
              e.location_id,
              e.production_date,
              e.shift_id,
              s.name  AS shift_name,
              e.product_id,
              p.fg_number,
              p.description AS product_description,
              e.custom_product_name,
              e.planned_quantity,
              e.quantity_breakdown,
              e.raw_quantity,
              e.priority,
              e.color,
              e.status,
              e.notes,
              e.sort_order,
              e.version,
              e.updated_at,
              e.updated_by_name
         FROM production_plan_entries e
         LEFT JOIN products p          ON p.id = e.product_id
         LEFT JOIN production_shifts s ON s.id = e.shift_id
        WHERE e.location_id = $1
          AND e.production_date BETWEEN $2 AND $3
          AND e.deleted_at IS NULL
        ORDER BY e.production_date, s.sort_order NULLS LAST, e.sort_order, e.id`,
      [locationId, fromDate, toDate]
    );
    return rows;
  }

  static async findEntryById(id) {
    const { rows } = await pool.query(
      `SELECT e.*, p.fg_number, p.description AS product_description, s.name AS shift_name
         FROM production_plan_entries e
         LEFT JOIN products p          ON p.id = e.product_id
         LEFT JOIN production_shifts s ON s.id = e.shift_id
        WHERE e.id = $1 AND e.deleted_at IS NULL`,
      [id]
    );
    return rows[0];
  }

  // ---------------------------------------------------------------- day flags
  static async findDayFlags(locationId, fromDate, toDate) {
    const { rows } = await pool.query(
      `SELECT id, location_id, production_date, flag, note
         FROM production_day_flags
        WHERE location_id = $1 AND production_date BETWEEN $2 AND $3`,
      [locationId, fromDate, toDate]
    );
    return rows;
  }

  // -------------------------------------------------------------- shift notes
  /**
   * One note per shift per day (migration 027). Morning and afternoon often run
   * different orders, so they get a line each rather than sharing one.
   */
  static async findShiftNotes(locationId, fromDate, toDate) {
    const { rows } = await pool.query(
      `SELECT n.id, n.production_date, n.shift_id, n.note,
              n.updated_at, n.updated_by_name, s.name AS shift_name
         FROM production_shift_notes n
         LEFT JOIN production_shifts s ON s.id = n.shift_id
        WHERE n.location_id = $1 AND n.production_date BETWEEN $2 AND $3
        ORDER BY n.production_date, s.sort_order NULLS LAST`,
      [locationId, fromDate, toDate]
    );
    return rows;
  }

  // -------------------------------------------------------- calendar exceptions
  /**
   * Exceptions for this location plus the global ones (location_id IS NULL).
   */
  static async findCalendarExceptions(locationId, fromDate, toDate) {
    const { rows } = await pool.query(
      `SELECT id, location_id, exception_date, type, note
         FROM production_calendar_exceptions
        WHERE (location_id = $1 OR location_id IS NULL)
          AND exception_date BETWEEN $2 AND $3`,
      [locationId, fromDate, toDate]
    );
    return rows;
  }

  // ----------------------------------------------------------------- products
  /**
   * FG autocomplete. Matches the FG number or anywhere in the description.
   */
  static async searchProducts(query, limit = 20) {
    const { rows } = await pool.query(
      `SELECT id, fg_number, description, sap_item_code
         FROM products
        WHERE is_active
          AND ($1 = '' OR fg_number ILIKE $2 OR description ILIKE $2)
        ORDER BY fg_number
        LIMIT $3`,
      [query, `%${query}%`, limit]
    );
    return rows;
  }
}

module.exports = ProductionPlan;
