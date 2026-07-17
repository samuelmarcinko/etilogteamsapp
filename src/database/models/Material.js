const pool = require('../config');
const MaterialPlacement = require('./MaterialPlacement');

// SELECT with category + aggregated placements.
// Legacy location_* fields kept (from materials.location_id = primary location)
// for backward compatibility; `placements` JSON array is the source of truth.
const BASE_SELECT = `
  SELECT m.*,
         l.zone AS location_zone, l.position AS location_position, l.code AS location_code,
         c.name AS category_name, c.color AS category_color, c.icon AS category_icon,
         COALESCE((
           SELECT json_agg(json_build_object(
             'location_id', mp.location_id,
             'location_code', pl.code,
             'zone', pl.zone,
             'position', pl.position,
             'quantity', mp.quantity
           ) ORDER BY
             CASE pl.zone WHEN 'MINI' THEN 0 WHEN 'D' THEN 1 WHEN 'A' THEN 2
                          WHEN 'B' THEN 3 WHEN 'C' THEN 4 ELSE 5 END,
             pl.position ASC)
           FROM material_placements mp
           JOIN pallet_locations pl ON pl.id = mp.location_id
           WHERE mp.material_id = m.id
         ), '[]'::json) AS placements
  FROM materials m
  LEFT JOIN pallet_locations l ON m.location_id = l.id
  LEFT JOIN material_categories c ON m.category_id = c.id`;

// Normalize incoming data into a placements array.
// Accepts data.placements [{location_id, quantity}] OR legacy location_id + quantity.
function normalizePlacements(data) {
  if (Array.isArray(data.placements) && data.placements.length) {
    return data.placements
      .filter(p => p.location_id)
      .map(p => ({ location_id: p.location_id, quantity: Math.max(0, parseInt(p.quantity, 10) || 0) }));
  }
  if (data.location_id) {
    return [{ location_id: data.location_id, quantity: Math.max(0, parseInt(data.quantity, 10) || 0) }];
  }
  return [];
}

class Material {
  // Case-insensitive code existence check (app-level duplicate guard).
  // Ignores soft-deleted materials so a freed code can be reused.
  static async existsByCode(code, excludeId = null) {
    const values = [code];
    let query = 'SELECT id FROM materials WHERE LOWER(code) = LOWER($1) AND deleted_at IS NULL';
    if (excludeId) { values.push(excludeId); query += ` AND id <> $${values.length}`; }
    const result = await pool.query(query, values);
    return result.rows.length > 0;
  }

  static async create(data) {
    const placements = normalizePlacements(data);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Total quantity = sum of placements when split, else the entered quantity
      const total = placements.length
        ? placements.reduce((s, p) => s + p.quantity, 0)
        : (data.quantity != null ? parseInt(data.quantity, 10) || 0 : 0);
      const primaryLocation = placements.length ? placements[0].location_id : (data.location_id || null);

      const ins = await client.query(
        `INSERT INTO materials (code, name, description, quantity, unit, location_id, category_id, created_by, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          data.code,
          data.name,
          data.description || null,
          total,
          data.unit || 'ks',
          primaryLocation,
          data.category_id || null,
          data.created_by || null,
          data.created_by_name || null
        ]
      );
      const material = ins.rows[0];

      if (placements.length) {
        await MaterialPlacement.replaceWithinTx(client, material.id, placements);
      }

      await client.query('COMMIT');
      return material;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Filters: { search, zone, category_id }
  // Search/zone match against placements (so split materials are found by any location).
  static async findAll(filters = {}) {
    const values = [];
    const where = [];

    if (filters.search) {
      values.push(`%${filters.search}%`);
      const i = values.length;
      where.push(`(m.code ILIKE $${i} OR m.name ILIKE $${i} OR m.description ILIKE $${i}
                   OR EXISTS (SELECT 1 FROM material_placements mp2
                              JOIN pallet_locations pl2 ON pl2.id = mp2.location_id
                              WHERE mp2.material_id = m.id AND pl2.code ILIKE $${i}))`);
    }
    if (filters.zone) {
      values.push(filters.zone);
      where.push(`EXISTS (SELECT 1 FROM material_placements mp3
                          JOIN pallet_locations pl3 ON pl3.id = mp3.location_id
                          WHERE mp3.material_id = m.id AND pl3.zone = $${values.length})`);
    }
    if (filters.category_id) {
      values.push(filters.category_id);
      where.push(`m.category_id = $${values.length}`);
    }

    // Hide soft-deleted materials from normal listings
    where.push('m.deleted_at IS NULL');

    let query = BASE_SELECT;
    query += ` WHERE ${where.join(' AND ')}`;
    query += ' ORDER BY m.updated_at DESC';

    const result = await pool.query(query, values);
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query(`${BASE_SELECT} WHERE m.id = $1`, [id]);
    return result.rows[0];
  }

  // Materials physically present at a location (via placements).
  // Returns each material with placement_quantity = qty at THIS location.
  static async findByLocationId(locationId) {
    const result = await pool.query(
      `SELECT m.*,
              c.name AS category_name, c.color AS category_color, c.icon AS category_icon,
              mp.quantity AS placement_quantity,
              mp.location_id,
              pl.code AS location_code, pl.zone AS location_zone, pl.position AS location_position
       FROM material_placements mp
       JOIN materials m ON m.id = mp.material_id
       JOIN pallet_locations pl ON pl.id = mp.location_id
       LEFT JOIN material_categories c ON m.category_id = c.id
       WHERE mp.location_id = $1 AND m.deleted_at IS NULL
       ORDER BY m.name ASC`,
      [locationId]
    );
    return result.rows;
  }

  static async update(id, data) {
    const placements = normalizePlacements(data);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let total, primaryLocation, codes = [];
      if (placements.length) {
        const res = await MaterialPlacement.replaceWithinTx(client, id, placements);
        total = res.total;
        codes = res.codes;
        primaryLocation = placements[0].location_id;
      } else {
        // No placements provided: clear them, fall back to entered quantity
        await client.query('DELETE FROM material_placements WHERE material_id = $1', [id]);
        total = data.quantity != null ? parseInt(data.quantity, 10) || 0 : null;
        primaryLocation = data.location_id || null;
      }

      const upd = await client.query(
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
          total,
          data.unit,
          primaryLocation,
          data.category_id || null,
          id
        ]
      );

      await client.query('COMMIT');
      const mat = upd.rows[0];
      if (mat) mat._placementCodes = codes;
      return mat;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Soft delete: mark as deleted (placements are kept intact so a restore
  // brings the positions back). Hidden from the map/lists via deleted_at.
  static async delete(id, user = null) {
    const result = await pool.query(
      `UPDATE materials
       SET deleted_at = CURRENT_TIMESTAMP, deleted_by = $2, deleted_by_name = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [id, user?.id || null, user?.name || null]
    );
    return result.rows[0] || null;
  }

  // Restore a soft-deleted material (clears deleted_at).
  static async restore(id) {
    const result = await pool.query(
      `UPDATE materials
       SET deleted_at = NULL, deleted_by = NULL, deleted_by_name = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND deleted_at IS NOT NULL
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Relocate material to a new location. Collapses placements into a single
  // placement at the target (entire material moves), logging a movement record.
  static async move(id, toLocationId, user, reason) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query('SELECT location_id, quantity FROM materials WHERE id = $1 FOR UPDATE', [id]);
      if (!cur.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const fromLocationId = cur.rows[0].location_id;
      const quantity = cur.rows[0].quantity;

      const upd = await client.query(
        'UPDATE materials SET location_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [toLocationId || null, id]
      );

      // Collapse placements to single target placement (keeps total quantity)
      await client.query('DELETE FROM material_placements WHERE material_id = $1', [id]);
      if (toLocationId) {
        await client.query(
          `INSERT INTO material_placements (material_id, location_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT (material_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
          [id, toLocationId, quantity]
        );
      }

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
        (SELECT COUNT(*) FROM materials WHERE deleted_at IS NULL)::int AS total_materials,
        (SELECT COUNT(DISTINCT mp.location_id)
           FROM material_placements mp
           JOIN materials m ON m.id = mp.material_id
           WHERE m.deleted_at IS NULL)::int AS occupied_locations,
        (SELECT COUNT(*) FROM pallet_locations)::int AS total_locations,
        (SELECT COUNT(*) FROM materials WHERE created_at::date = CURRENT_DATE AND deleted_at IS NULL)::int AS added_today
    `);
    return result.rows[0];
  }
}

module.exports = Material;
