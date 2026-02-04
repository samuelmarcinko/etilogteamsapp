const User = require('../database/models/User');

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
  requireDbRole
};
