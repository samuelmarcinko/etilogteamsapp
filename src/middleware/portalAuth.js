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
  getUserPermissions,
  legacyPermissions
};
