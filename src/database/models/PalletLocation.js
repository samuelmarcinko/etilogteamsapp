const pool = require('../config');

class PalletLocation {
  // All locations, ordered by zone then position
  static async findAll() {
    const result = await pool.query(
      `SELECT * FROM pallet_locations
       ORDER BY
         CASE zone WHEN 'MINI' THEN 0 WHEN 'D' THEN 1 WHEN 'A' THEN 2
                   WHEN 'B' THEN 3 WHEN 'C' THEN 4 ELSE 5 END,
         position ASC`
    );
    return result.rows;
  }

  // Locations with material summary (count + total quantity) for the map.
  // Counts via placements so split materials register on every location.
  static async findAllWithSummary() {
    const result = await pool.query(
      `SELECT l.*,
              COUNT(mp.id) FILTER (WHERE m.id IS NOT NULL)::int AS material_count,
              COALESCE(SUM(mp.quantity) FILTER (WHERE m.id IS NOT NULL), 0)::int AS total_quantity
       FROM pallet_locations l
       LEFT JOIN material_placements mp ON mp.location_id = l.id
       LEFT JOIN materials m ON m.id = mp.material_id AND m.deleted_at IS NULL
       GROUP BY l.id
       ORDER BY
         CASE l.zone WHEN 'MINI' THEN 0 WHEN 'D' THEN 1 WHEN 'A' THEN 2
                     WHEN 'B' THEN 3 WHEN 'C' THEN 4 ELSE 5 END,
         l.position ASC`
    );
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM pallet_locations WHERE id = $1', [id]);
    return result.rows[0];
  }

  static async findByCode(code) {
    const result = await pool.query('SELECT * FROM pallet_locations WHERE code = $1', [code]);
    return result.rows[0];
  }

  static async findByZonePosition(zone, position) {
    const result = await pool.query(
      'SELECT * FROM pallet_locations WHERE zone = $1 AND position = $2',
      [zone, position]
    );
    return result.rows[0];
  }

  static async updateNotes(id, notes) {
    const result = await pool.query(
      'UPDATE pallet_locations SET notes = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [notes || null, id]
    );
    return result.rows[0];
  }
}

module.exports = PalletLocation;
