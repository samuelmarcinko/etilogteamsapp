const pool = require('../config');

class MaterialCategory {
  static async findAll() {
    const result = await pool.query('SELECT * FROM material_categories ORDER BY name ASC');
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM material_categories WHERE id = $1', [id]);
    return result.rows[0];
  }

  static async create(data) {
    const result = await pool.query(
      `INSERT INTO material_categories (name, color, icon)
       VALUES ($1, $2, $3) RETURNING *`,
      [data.name, data.color || '#3b82f6', data.icon || null]
    );
    return result.rows[0];
  }

  static async update(id, data) {
    const result = await pool.query(
      `UPDATE material_categories SET
         name = COALESCE($1, name),
         color = COALESCE($2, color),
         icon = $3,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [data.name, data.color, data.icon || null, id]
    );
    return result.rows[0];
  }

  static async delete(id) {
    await pool.query('DELETE FROM material_categories WHERE id = $1', [id]);
  }
}

module.exports = MaterialCategory;
