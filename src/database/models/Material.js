const pool = require('../config');

// SELECT with location + category joined (shared shape for list/detail)
const BASE_SELECT = `
  SELECT m.*,
         l.zone AS location_zone, l.position AS location_position, l.code AS location_code,
         c.name AS category_name, c.color AS category_color, c.icon AS category_icon
  FROM materials m
  LEFT JOIN pallet_locations l ON m.location_id = l.id
  LEFT JOIN material_categories c ON m.category_id = c.id`;

class Material {
  static async create(data) {
    const result = await pool.query(
      `INSERT INTO materials (code, name, description, quantity, unit, location_id, category_id, created_by, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        data.code,
        data.name,
        data.description || null,
        data.quantity != null ? data.quantity : 0,
        data.unit || 'ks',
        data.location_id || null,
        data.category_id || null,
        data.created_by || null,
        data.created_by_name || null
      ]
    );
    return result.rows[0];
  }

  // Filters: { search, zone, category_id }
  static async findAll(filters = {}) {
    const values = [];
    const where = [];

    if (filters.search) {
      values.push(`%${filters.search}%`);
      const i = values.length;
      where.push(`(m.code ILIKE $${i} OR m.name ILIKE $${i} OR m.description ILIKE $${i} OR l.code ILIKE $${i})`);
    }
    if (filters.zone) {
      values.push(filters.zone);
      where.push(`l.zone = $${values.length}`);
    }
    if (filters.category_id) {
      values.push(filters.category_id);
      where.push(`m.category_id = $${values.length}`);
    }

    let query = BASE_SELECT;
    if (where.length) query += ` WHERE ${where.join(' AND ')}`;
    query += ' ORDER BY m.updated_at DESC';

    const result = await pool.query(query, values);
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query(`${BASE_SELECT} WHERE m.id = $1`, [id]);
    return result.rows[0];
  }

  static async findByLocationId(locationId) {
    const result = await pool.query(
      `${BASE_SELECT} WHERE m.location_id = $1 ORDER BY m.name ASC`,
      [locationId]
    );
    return result.rows;
  }

  static async update(id, data) {
    const result = await pool.query(
      `UPDATE materials SET
         code = COALESCE($1, code),
         name = COALESCE($2, name),
         description = $3,
         quantity = COALESCE($4, quantity),
         unit = COALESCE($5, unit),
         location_id = $6,
         category_id = $7,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 RETURNING *`,
      [
        data.code,
        data.name,
        data.description || null,
        data.quantity,
        data.unit,
        data.location_id || null,
        data.category_id || null,
        id
      ]
    );
    return result.rows[0];
  }

  static async delete(id) {
    await pool.query('DELETE FROM materials WHERE id = $1', [id]);
  }

  // Relocate material to a new location, logging a movement record.
  static async move(id, toLocationId, user, reason) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query('SELECT location_id FROM materials WHERE id = $1 FOR UPDATE', [id]);
      if (!cur.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const fromLocationId = cur.rows[0].location_id;

      const upd = await client.query(
        'UPDATE materials SET location_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [toLocationId || null, id]
      );

      await client.query(
        `INSERT INTO material_movements (material_id, from_location_id, to_location_id, moved_by, moved_by_name, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, fromLocationId, toLocationId || null, user?.id || null, user?.name || null, reason || null]
      );

      // Fetch location codes for audit readability
      let fromCode = null, toCode = null;
      if (fromLocationId) {
        const fRes = await client.query('SELECT code FROM pallet_locations WHERE id = $1', [fromLocationId]);
        fromCode = fRes.rows[0]?.code || null;
      }
      if (toLocationId) {
        const tRes = await client.query('SELECT code FROM pallet_locations WHERE id = $1', [toLocationId]);
        toCode = tRes.rows[0]?.code || null;
      }

      await client.query('COMMIT');
      const mat = upd.rows[0];
      mat._moveInfo = { fromLocationId, toLocationId, fromCode, toCode };
      return mat;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Movement history (optionally for one material)
  static async getMovements(materialId = null, limit = 200) {
    const values = [];
    let query = `
      SELECT mv.*,
             m.code AS material_code, m.name AS material_name,
             fl.code AS from_code, tl.code AS to_code
      FROM material_movements mv
      LEFT JOIN materials m ON mv.material_id = m.id
      LEFT JOIN pallet_locations fl ON mv.from_location_id = fl.id
      LEFT JOIN pallet_locations tl ON mv.to_location_id = tl.id`;
    if (materialId) {
      values.push(materialId);
      query += ` WHERE mv.material_id = $${values.length}`;
    }
    values.push(limit);
    query += ` ORDER BY mv.moved_at DESC LIMIT $${values.length}`;
    const result = await pool.query(query, values);
    return result.rows;
  }

  // Dashboard stats
  static async getStats() {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM materials)::int AS total_materials,
        (SELECT COUNT(DISTINCT location_id) FROM materials WHERE location_id IS NOT NULL)::int AS occupied_locations,
        (SELECT COUNT(*) FROM pallet_locations)::int AS total_locations,
        (SELECT COUNT(*) FROM materials WHERE created_at::date = CURRENT_DATE)::int AS added_today
    `);
    return result.rows[0];
  }
}

module.exports = Material;
