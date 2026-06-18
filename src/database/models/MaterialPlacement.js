const pool = require('../config');

class MaterialPlacement {
  // All placements for a material, with location info
  static async findByMaterial(materialId) {
    const result = await pool.query(
      `SELECT mp.*, pl.code AS location_code, pl.zone, pl.position
       FROM material_placements mp
       JOIN pallet_locations pl ON pl.id = mp.location_id
       WHERE mp.material_id = $1
       ORDER BY
         CASE pl.zone WHEN 'MINI' THEN 0 WHEN 'D' THEN 1 WHEN 'A' THEN 2
                      WHEN 'B' THEN 3 WHEN 'C' THEN 4 ELSE 5 END,
         pl.position ASC`,
      [materialId]
    );
    return result.rows;
  }

  // Replace all placements for a material inside an existing transaction client.
  // placements: [{ location_id, quantity }]
  // Returns { total, codes } where total = sum of quantities, codes = location codes.
  static async replaceWithinTx(client, materialId, placements) {
    await client.query('DELETE FROM material_placements WHERE material_id = $1', [materialId]);

    let total = 0;
    const codes = [];
    for (const p of placements) {
      if (!p.location_id) continue;
      const qty = Math.max(0, parseInt(p.quantity, 10) || 0);
      total += qty;
      await client.query(
        `INSERT INTO material_placements (material_id, location_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (material_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [materialId, p.location_id, qty]
      );
      const cRes = await client.query('SELECT code FROM pallet_locations WHERE id = $1', [p.location_id]);
      if (cRes.rows[0]) codes.push(cRes.rows[0].code);
    }
    return { total, codes };
  }
}

module.exports = MaterialPlacement;
