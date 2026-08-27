const pool = require('../config');

class User {
  /**
   * Create or update user
   */
  static async upsert(userData) {
    const query = `
      INSERT INTO users (user_id, email, display_name, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id)
      DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        role = EXCLUDED.role,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const values = [
      userData.userId,
      userData.email,
      userData.displayName,
      userData.role || 'user'
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Find user by user ID
   */
  static async findByUserId(userId) {
    const query = 'SELECT * FROM users WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }

  /**
   * Find user by email
   */
  static async findByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await pool.query(query, [email]);
    return result.rows[0];
  }

  /**
   * Get all users
   */
  static async findAll() {
    const query = 'SELECT * FROM users ORDER BY display_name';
    const result = await pool.query(query);
    return result.rows;
  }

  /**
   * Update user role
   */
  static async updateRole(userId, role) {
    const query = `
      UPDATE users
      SET role = $1, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [role, userId]);
    return result.rows[0];
  }

  /**
   * How many users hold each role, as { roleName: count }.
   *
   * The roles screen shows this next to every role: it is the difference
   * between "this checkbox affects nobody" and "this checkbox affects the
   * whole warehouse", and it is what makes a deletion refusable.
   */
  static async countByRole() {
    const { rows } = await pool.query(
      'SELECT role, COUNT(*)::int AS count FROM users GROUP BY role'
    );
    return Object.fromEntries(rows.map((row) => [row.role, row.count]));
  }

  /**
   * Toggle user hidden flag
   */
  static async toggleHidden(userId) {
    const query = `
      UPDATE users
      SET hidden = NOT COALESCE(hidden, false), updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `;

    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }

  /**
   * Get all hidden user IDs
   */
  static async getHiddenUserIds() {
    const query = 'SELECT user_id FROM users WHERE hidden = true';
    const result = await pool.query(query);
    return result.rows.map(r => r.user_id);
  }
}

module.exports = User;
