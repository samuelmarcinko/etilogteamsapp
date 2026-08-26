const pool = require('../config');
const logger = require('../../utils/logger');

/**
 * Roles and the role -> permission matrix (migration 024).
 *
 * The matrix is a handful of rows that change only when an admin edits a role,
 * so it is cached in memory rather than queried on every request. Writes go
 * through this model and invalidate the cache; a short TTL covers the case of a
 * second app instance making the change.
 */

const PERMISSION_KEYS = [
  'hr.access',
  'hr.manage',
  'fleet.access',
  'warehouse.read',
  'warehouse.write',
  'production.view',
  'production.manage'
];

// Granted to everyone, always. HR is the baseline every employee needs and the
// admin UI renders its checkbox locked on.
const ALWAYS_GRANTED = ['hr.access'];

const CACHE_TTL_MS = 60 * 1000;

let cache = null;
let cachedAt = 0;

class Role {
  static get PERMISSION_KEYS() {
    return PERMISSION_KEYS;
  }

  static get ALWAYS_GRANTED() {
    return ALWAYS_GRANTED;
  }

  /**
   * Drop the cached matrix. Call after any write to roles/role_permissions.
   */
  static invalidateCache() {
    cache = null;
    cachedAt = 0;
  }

  /**
   * The whole matrix as { roleName: Set(permissionKey) }.
   *
   * On a database error this returns null rather than throwing, so callers can
   * fall back to the legacy role checks instead of locking everybody out.
   */
  static async getMatrix() {
    if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;

    try {
      const { rows } = await pool.query(`
        SELECT r.name AS role_name, rp.permission_key
          FROM roles r
          LEFT JOIN role_permissions rp ON rp.role_id = r.id
      `);

      const matrix = {};
      for (const row of rows) {
        matrix[row.role_name] = matrix[row.role_name] || new Set();
        if (row.permission_key) matrix[row.role_name].add(row.permission_key);
      }

      cache = matrix;
      cachedAt = Date.now();
      return matrix;
    } catch (error) {
      logger.error('Failed to load permission matrix', { error: error.message });
      return null;
    }
  }

  /**
   * Permissions held by a role name, as an array.
   *
   * admin holds everything, unconditionally - an admin is never locked out by a
   * missing checkbox. Every other role gets ALWAYS_GRANTED plus whatever the
   * matrix grants it; an unknown role name therefore ends up with HR only,
   * which is what the portal gives an unrecognised role today.
   *
   * Returns null if the matrix could not be read, so the caller can fall back.
   */
  static async getPermissionsForRole(roleName) {
    if (roleName === 'admin') return [...PERMISSION_KEYS];

    const matrix = await Role.getMatrix();
    if (!matrix) return null;

    const granted = new Set(ALWAYS_GRANTED);
    for (const key of matrix[roleName] || []) granted.add(key);
    return [...granted];
  }

  /**
   * All roles with their granted permissions, for the admin UI.
   */
  static async findAllWithPermissions() {
    const { rows } = await pool.query(`
      SELECT r.id, r.name, r.label, r.is_system, r.created_at, r.updated_at,
             COALESCE(
               ARRAY_AGG(rp.permission_key ORDER BY rp.permission_key)
                 FILTER (WHERE rp.permission_key IS NOT NULL),
               '{}'
             ) AS permissions
        FROM roles r
        LEFT JOIN role_permissions rp ON rp.role_id = r.id
       GROUP BY r.id
       ORDER BY r.is_system DESC, r.name
    `);
    return rows;
  }

  static async findByName(name) {
    const { rows } = await pool.query('SELECT * FROM roles WHERE name = $1', [name]);
    return rows[0];
  }

  /**
   * Role names that exist, for validating a role assignment.
   */
  static async listNames() {
    const { rows } = await pool.query('SELECT name FROM roles ORDER BY name');
    return rows.map((r) => r.name);
  }
}

module.exports = Role;
