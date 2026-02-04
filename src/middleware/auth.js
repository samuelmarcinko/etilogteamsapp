const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
require('dotenv').config();

// JWKS client for validating Azure AD tokens
const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${process.env.TENANT_ID}/discovery/v2.0/keys`
});

/**
 * Get signing key from JWKS
 */
function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

/**
 * Middleware to verify Azure AD / Teams token
 */
async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7);

    const clientId = process.env.CLIENT_ID || process.env.MICROSOFT_APP_ID;
    const tenantId = process.env.TENANT_ID;

    // Verify token - accept both v1.0 and v2.0 tokens, and API URIs
    jwt.verify(
      token,
      getKey,
      {
        audience: [clientId, `api://${clientId}`],
        issuer: [
          `https://login.microsoftonline.com/${tenantId}/v2.0`,
          `https://sts.windows.net/${tenantId}/`
        ],
        algorithms: ['RS256']
      },
      (err, decoded) => {
        if (err) {
          console.error('Token verification failed:', err.message);
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid token: ' + err.message
          });
        }

        // Attach user info to request
        req.user = {
          id: decoded.oid || decoded.sub,
          email: decoded.email || decoded.upn || decoded.preferred_username,
          name: decoded.name,
          roles: decoded.roles || [],
          tenantId: decoded.tid
        };

        next();
      }
    );
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed'
    });
  }
}

/**
 * Middleware to verify user role
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not authenticated'
      });
    }

    const userRoles = req.user.roles || [];
    const hasRole = roles.some(role => userRoles.includes(role));

    if (!hasRole) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions'
      });
    }

    next();
  };
}

/**
 * Optional auth middleware - doesn't fail if no token
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.substring(7);

    const clientId = process.env.CLIENT_ID || process.env.MICROSOFT_APP_ID;
    const tenantId = process.env.TENANT_ID;

    jwt.verify(
      token,
      getKey,
      {
        audience: [clientId, `api://${clientId}`],
        issuer: [
          `https://login.microsoftonline.com/${tenantId}/v2.0`,
          `https://sts.windows.net/${tenantId}/`
        ],
        algorithms: ['RS256']
      },
      (err, decoded) => {
        if (!err && decoded) {
          req.user = {
            id: decoded.oid || decoded.sub,
            email: decoded.email || decoded.upn || decoded.preferred_username,
            name: decoded.name,
            roles: decoded.roles || [],
            tenantId: decoded.tid
          };
        }
        next();
      }
    );
  } catch (error) {
    next();
  }
}

module.exports = {
  verifyToken,
  requireRole,
  optionalAuth
};
