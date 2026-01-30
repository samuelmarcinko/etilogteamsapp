const pool = require('../config');

class SickNote {
  /**
   * Create a new sick note
   */
  static async create(data) {
    const result = await pool.query(
      `INSERT INTO sick_notes (
        user_id, user_name, user_email, title, description,
        start_date, end_date, doctor_name, diagnosis,
        file_path, file_name, file_type, file_size
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        data.userId, data.userName, data.userEmail,
        data.title, data.description || null,
        data.startDate, data.endDate,
        data.doctorName || null, data.diagnosis || null,
        data.filePath || null, data.fileName || null,
        data.fileType || null, data.fileSize || null
      ]
    );
    return result.rows[0];
  }

  /**
   * Get sick note by ID
   */
  static async findById(id) {
    const result = await pool.query(
      'SELECT * FROM sick_notes WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  /**
   * Get all sick notes for a user
   */
  static async findByUserId(userId) {
    const result = await pool.query(
      'SELECT * FROM sick_notes WHERE user_id = $1 ORDER BY start_date DESC',
      [userId]
    );
    return result.rows;
  }

  /**
   * Get all sick notes (admin view)
   */
  static async findAll(filters = {}) {
    let query = 'SELECT * FROM sick_notes WHERE 1=1';
    const values = [];
    let paramCount = 1;

    if (filters.userId) {
      query += ` AND user_id = $${paramCount}`;
      values.push(filters.userId);
      paramCount++;
    }

    if (filters.status) {
      query += ` AND status = $${paramCount}`;
      values.push(filters.status);
      paramCount++;
    }

    if (filters.year) {
      query += ` AND EXTRACT(YEAR FROM start_date) = $${paramCount}`;
      values.push(filters.year);
      paramCount++;
    }

    query += ' ORDER BY start_date DESC';

    const result = await pool.query(query, values);
    return result.rows;
  }

  /**
   * Update sick note
   */
  static async update(id, data) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = ['title', 'description', 'start_date', 'end_date',
      'doctor_name', 'diagnosis', 'status'];

    for (const field of allowedFields) {
      const camelField = field.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
      if (data[camelField] !== undefined) {
        fields.push(`${field} = $${paramCount}`);
        values.push(data[camelField]);
        paramCount++;
      }
    }

    if (fields.length === 0) return this.findById(id);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const result = await pool.query(
      `UPDATE sick_notes SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    return result.rows[0];
  }

  /**
   * Update file info
   */
  static async updateFile(id, filePath, fileName, fileType, fileSize) {
    const result = await pool.query(
      `UPDATE sick_notes
       SET file_path = $1, file_name = $2, file_type = $3, file_size = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [filePath, fileName, fileType, fileSize, id]
    );
    return result.rows[0];
  }

  /**
   * Delete sick note
   */
  static async delete(id) {
    const result = await pool.query(
      'DELETE FROM sick_notes WHERE id = $1 RETURNING *',
      [id]
    );
    return result.rows[0];
  }

  /**
   * Get stats for a user in a year
   */
  static async getUserStats(userId, year) {
    const result = await pool.query(
      `SELECT
        COUNT(*) as total_notes,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_notes,
        SUM(CASE WHEN status = 'active' THEN end_date - start_date + 1 ELSE 0 END) as total_days
       FROM sick_notes
       WHERE user_id = $1 AND EXTRACT(YEAR FROM start_date) = $2`,
      [userId, year]
    );
    return result.rows[0];
  }
}

module.exports = SickNote;
