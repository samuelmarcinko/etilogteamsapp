const pool = require('../config');

class FleetVehicle {
  static async create(data) {
    const query = `
      INSERT INTO fleet_vehicles (name, license_plate, brand, model, year_manufactured, month_manufactured,
        stk_valid_until, ek_valid_until, highway_sticker_valid_until, notification_email, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`;
    const values = [
      data.name, data.license_plate, data.brand || null, data.model || null,
      data.year_manufactured || null, data.month_manufactured || null,
      data.stk_valid_until || null, data.ek_valid_until || null,
      data.highway_sticker_valid_until || null, data.notification_email, data.notes || null
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async findAll(activeOnly = false) {
    let query = 'SELECT * FROM fleet_vehicles';
    if (activeOnly) query += ' WHERE is_active = true';
    query += ' ORDER BY name ASC';
    const result = await pool.query(query);
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM fleet_vehicles WHERE id = $1', [id]);
    return result.rows[0];
  }

  static async update(id, data) {
    const query = `
      UPDATE fleet_vehicles SET
        name = COALESCE($1, name),
        license_plate = COALESCE($2, license_plate),
        brand = $3,
        model = $4,
        year_manufactured = $5,
        month_manufactured = $6,
        stk_valid_until = $7,
        ek_valid_until = $8,
        highway_sticker_valid_until = $9,
        notification_email = COALESCE($10, notification_email),
        notes = $11,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $12
      RETURNING *`;
    const values = [
      data.name, data.license_plate, data.brand || null, data.model || null,
      data.year_manufactured || null, data.month_manufactured || null,
      data.stk_valid_until || null, data.ek_valid_until || null,
      data.highway_sticker_valid_until || null, data.notification_email, data.notes || null, id
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async toggleActive(id) {
    const result = await pool.query(
      'UPDATE fleet_vehicles SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [id]
    );
    return result.rows[0];
  }

  static async delete(id) {
    await pool.query('DELETE FROM fleet_vehicles WHERE id = $1', [id]);
  }

  static async getExpiringVehicles() {
    const result = await pool.query(`
      SELECT * FROM fleet_vehicles
      WHERE is_active = true AND (
        stk_valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '31 days'
        OR ek_valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '31 days'
        OR highway_sticker_valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '31 days'
      )
      ORDER BY LEAST(
        COALESCE(stk_valid_until, '9999-12-31'),
        COALESCE(ek_valid_until, '9999-12-31'),
        COALESCE(highway_sticker_valid_until, '9999-12-31')
      ) ASC
    `);
    return result.rows;
  }

  static async wasNotificationSent(vehicleId, notificationType, daysBefore) {
    const result = await pool.query(
      `SELECT id FROM fleet_notification_log
       WHERE vehicle_id = $1 AND notification_type = $2 AND days_before = $3`,
      [vehicleId, notificationType, daysBefore]
    );
    return result.rows.length > 0;
  }

  static async logNotification(vehicleId, notificationType, daysBefore, sentTo) {
    await pool.query(
      `INSERT INTO fleet_notification_log (vehicle_id, notification_type, days_before, sent_to)
       VALUES ($1, $2, $3, $4)`,
      [vehicleId, notificationType, daysBefore, sentTo]
    );
  }

  static async clearNotificationLog(vehicleId, notificationType) {
    await pool.query(
      'DELETE FROM fleet_notification_log WHERE vehicle_id = $1 AND notification_type = $2',
      [vehicleId, notificationType]
    );
  }
}

module.exports = FleetVehicle;
