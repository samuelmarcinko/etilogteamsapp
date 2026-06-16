const pool = require('../config');

class WarehouseAudit {
  // Log an action. user = { id, name }. details serialized to JSONB.
  static async log(user, action, entity, entityId, details = null) {
    try {
      await pool.query(
        `INSERT INTO warehouse_audit_log (user_id, user_name, action, entity, entity_id, details)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          user?.id || null,
          user?.name || null,
          action,
          entity,
          entityId || null,
          details ? JSON.stringify(details) : null
        ]
      );
    } catch (err) {
      // Audit must never break the main operation
      console.error('Warehouse audit log failed:', err.message);
    }
  }

  static async findAll({ limit = 200, entity = null } = {}) {
    let query = 'SELECT * FROM warehouse_audit_log';
    const values = [];
    if (entity) {
      values.push(entity);
      query += ` WHERE entity = $${values.length}`;
    }
    values.push(limit);
    query += ` ORDER BY created_at DESC LIMIT $${values.length}`;
    const result = await pool.query(query, values);
    return result.rows;
  }
}

module.exports = WarehouseAudit;
