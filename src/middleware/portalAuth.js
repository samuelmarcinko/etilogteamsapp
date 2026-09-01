const User = require('../database/models/User');
const Role = require('../database/models/Role');
const logger = require('../utils/logger');

/**
 * The access rules exactly as the portal enforces them today, expressed as
 * permission keys.
 *
 * This is a transcription, not a new policy - portal.js hasModuleAccess() and
 * canEditWarehouse() for the module tiles, and the requireDbRole(...) lists on
 * the routes for the server side. It exists for two reasons: it is the fallback
 * when the permission matrix cannot be read, and it is the reference the shadow
 * comparison checks the matrix against.
 *
 * Do not "improve" these rules. They are correct when they match production.
 */
function legacyPermissions(roleName) {
  if (roleName === 'admin') return [...Role.PERMISSION_KEYS];

  const granted = ['hr.access']; // hasModuleAccess: every role has HR

  if (roleName === 'spravca') {
    // requireDbRole('admin','spravca') on adminRoutes, quotaRoutes, sickNoteRoutes
    granted.push('hr.manage');
  }
  if (roleName === 'sklad') {
    granted.push('warehouse.read', 'warehouse.write');
  }
  if (roleName === 'sklad_read') {
    granted.push('warehouse.read');
  }
  // fleet.access is admin-only today, so no non-admin role gets it.
  // production.* does not exist yet.

  return granted;
}

/**
 * Permissions held by a role, resolved from the admin-managed matrix.
 *
 * Falls back to the legacy rules if the matrix cannot be read, so a database
 * hiccup degrades to today's behaviour instead of locking everyone out.
 */
async function getUserPermissions(roleName) {
  const role = roleName || 'user';

  const fromMatrix = await Role.getPermissionsForRole(role);
  if (fromMatrix) return fromMatrix;

  logger.warn('Permission matrix unavailable, falling back to legacy rules', { role });
  return legacyPermissions(role);
}

/**
 * Attach DB role to request (after verifyToken)
 * Looks up user in DB and sets req.userRole
 */
async function attachDbRole(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next();
    }

    const dbUser = await User.findByUserId(req.user.id);
    req.userRole = dbUser?.role || 'user';
    next();
  } catch (error) {
    // Don't fail, just default to user
    req.userRole = 'user';
    next();
  }
}

/**
 * How permission checks behave. Set with ACCESS_CONTROL_MODE in .env.
 *
 *   legacy   the role lists decide; the matrix is not consulted at all.
 *            The panic switch - restores the pre-matrix behaviour exactly.
 *   shadow   the role lists still decide, but every request is also resolved
 *            through the matrix and any disagreement is logged. Behaviourally
 *            identical to legacy; this is how parity gets proven on real
 *            traffic rather than on a transcription. (default)
 *   enforce  the matrix decides.
 *
 * Switching back is one variable and a restart - no redeploy, no database
 * change.
 */
const VALID_MODES = ['legacy', 'shadow', 'enforce'];

function getAccessControlMode() {
  const mode = (process.env.ACCESS_CONTROL_MODE || 'shadow').trim().toLowerCase();
  if (!VALID_MODES.includes(mode)) {
    logger.warn('Unknown ACCESS_CONTROL_MODE, falling back to shadow', { mode });
    return 'shadow';
  }
  return mode;
}

function forbidden(res) {
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Insufficient permissions'
  });
}

/**
 * Require a permission key, with the role list it replaces kept alongside.
 *
 *   requirePermission('warehouse.write', { legacyRoles: ['admin', 'sklad'] })
 *
 * legacyRoles is exactly what requireDbRole(...) accepted at this call site.
 * Keeping it here is what makes the shadow comparison meaningful: it checks the
 * matrix against the real gate on the real route, not against a transcription
 * of it written somewhere else. Once enforce has run for a while these can be
 * dropped.
 */
function requirePermission(permissionKey, options = {}) {
  const legacyRoles = options.legacyRoles || [];

  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      // Routers that do not use attachDbRole still need the role, same as
      // requireDbRole does its own lookup.
      if (!req.userRole) {
        const dbUser = await User.findByUserId(req.user.id);
        req.userRole = dbUser?.role || 'user';
      }

      const role = req.userRole;
      const legacyAllowed = legacyRoles.includes(role);
      const mode = getAccessControlMode();

      if (mode === 'legacy') {
        return legacyAllowed ? next() : forbidden(res);
      }

      const permissions = await getUserPermissions(role);
      const matrixAllowed = permissions.includes(permissionKey);

      if (mode === 'shadow') {
        if (matrixAllowed !== legacyAllowed) {
          logger.warn('ACCESS SHADOW MISMATCH', {
            role,
            permission: permissionKey,
            method: req.method,
            path: req.originalUrl,
            legacyAllows: legacyAllowed,
            matrixAllows: matrixAllowed
          });
        }
        return legacyAllowed ? next() : forbidden(res);
      }

      return matrixAllowed ? next() : forbidden(res);
    } catch (error) {
      logger.error('Permission check failed', {
        permission: permissionKey,
        error: error.message
      });
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to verify permissions'
      });
    }
  };
}

/**
 * Require specific DB role
 */
function requireDbRole(...roles) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      // If role already attached
      if (req.userRole) {
        if (roles.includes(req.userRole)) {
          return next();
        }
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Insufficient permissions'
        });
      }

      // Lookup role
      const dbUser = await User.findByUserId(req.user.id);
      req.userRole = dbUser?.role || 'user';

      if (roles.includes(req.userRole)) {
        return next();
      }

      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions'
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to verify permissions'
      });
    }
  };
}

module.exports = {
  attachDbRole,
  requireDbRole,
  requirePermission,
  getUserPermissions,
  legacyPermissions,
  getAccessControlMode
};
