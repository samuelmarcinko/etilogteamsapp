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

  // Unified activity feed for the Movements page (material actions:
  // created / updated / deleted / moved). Joins the current material row
  // so the code/name stay resolvable even when details are sparse.
  static async findFeed({ limit = 300, action = null, search = null } = {}) {
    const values = [];
    const where = [`a.entity = 'material'`];
    if (action) {
      values.push(action);
      where.push(`a.action = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      const i = values.length;
      where.push(`((a.details->>'code') ILIKE $${i} OR m.code ILIKE $${i} OR m.name ILIKE $${i} OR a.user_name ILIKE $${i})`);
    }
    values.push(limit);
    const query = `
      SELECT a.*, m.code AS material_code, m.name AS material_name,
             m.deleted_at AS material_deleted_at, (m.id IS NOT NULL) AS material_exists
      FROM warehouse_audit_log a
      LEFT JOIN materials m ON a.entity = 'material' AND m.id = a.entity_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.created_at DESC
      LIMIT $${values.length}`;
    const result = await pool.query(query, values);
    return result.rows;
  }
}

module.exports = WarehouseAudit;
