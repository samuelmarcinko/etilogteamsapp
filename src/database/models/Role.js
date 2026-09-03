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
  'production.manage',
  // Deliberately separate from production.view: plenty of people need to read
  // the plan without wanting a message every time it moves.
  'production.notify'
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

  /** How many users currently hold a role. Guards deletion. */
  static async countUsers(name) {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users WHERE role = $1', [name]);
    return rows[0].n;
  }

  // ------------------------------------------------------------------ writes
  /**
   * Replace a role's permissions with exactly `keys`.
   *
   * Delete-then-insert inside one transaction rather than diffing: the set is
   * seven rows, and a diff is more code to get subtly wrong than it saves.
   *
   * admin is refused. It holds every permission unconditionally in
   * getPermissionsForRole, so a row here would be decoration - and if it were
   * ever honoured, an admin could switch off their own access to the screen
   * that grants it back.
   */
  static async setPermissions(name, keys) {
    if (name === 'admin') return { refused: 'admin' };

    const unknown = keys.filter((key) => !PERMISSION_KEYS.includes(key));
    if (unknown.length) return { unknownKeys: unknown };

    const role = await Role.findByName(name);
    if (!role) return { notFound: true };

    // hr.access is forced on by the resolver anyway; storing it keeps the row
    // set and the effective answer in agreement, so the admin screen and the
    // database say the same thing.
    const granted = [...new Set([...keys, ...ALWAYS_GRANTED])];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [role.id]);
      if (granted.length) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_key)
           SELECT $1, UNNEST($2::varchar[])`,
          [role.id, granted]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    Role.invalidateCache();
    logger.info('Role permissions updated', { role: name, permissions: granted });
    return { role: name, permissions: granted };
  }

  /**
   * Create a custom role. The name is what lands in users.role, so it is
   * restricted to the shape those values already have and can never be changed
   * afterwards - renaming would orphan every user holding it.
   */
  static async create({ name, label, permissions = [] }) {
    const clean = String(name || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(clean)) return { badName: true };
    if (await Role.findByName(clean)) return { exists: true };

    const { rows } = await pool.query(
      'INSERT INTO roles (name, label, is_system) VALUES ($1, $2, FALSE) RETURNING *',
      [clean, String(label || clean).trim().slice(0, 100)]
    );

    Role.invalidateCache();
    const withPermissions = await Role.setPermissions(clean, permissions);
    logger.info('Role created', { role: clean });
    return { role: rows[0], permissions: withPermissions.permissions || [...ALWAYS_GRANTED] };
  }

  /**
   * Delete a custom role. System roles stay, and a role somebody still holds
   * stays too - deleting it would leave those users with a role that grants
   * nothing but HR, silently.
   */
  static async remove(name) {
    const role = await Role.findByName(name);
    if (!role) return { notFound: true };
    if (role.is_system) return { refused: 'system' };

    const holders = await Role.countUsers(name);
    if (holders > 0) return { inUse: holders };

    await pool.query('DELETE FROM roles WHERE id = $1', [role.id]);
    Role.invalidateCache();
    logger.info('Role deleted', { role: name });
    return { deleted: name };
  }
}

module.exports = Role;
