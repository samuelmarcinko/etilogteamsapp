const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const logger = require('../utils/logger');
const localAuth = require('../services/localAuthService');
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
 * Which of the two kinds of token is this?
 *
 * Decided by the algorithm in the header, and the two paths never share a key:
 * an Azure token is only ever checked as RS256 against the JWKS keys, ours only
 * ever as HS256 against our own secret. Reading `alg` and then handing the
 * token to a verifier that accepts anything is the classic way this goes wrong
 * - a token can claim HS256 and be signed with the RSA public key, which is
 * published. Each branch below pins its algorithm explicitly.
 *
 * Unparseable headers fall through to the Azure path, which rejects them.
 */
function isLocalToken(token) {
  try {
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64').toString('utf8'));
    return header.alg === 'HS256';
  } catch (error) {
    return false;
  }
}

/**
 * Kam smie tablet zo skladu.
 *
 * Visí na stene v hale, prihlásený natrvalo, a kto naň dosiahne, dosiahne aj
 * na jeho token. Preto sa mu neobmedzujú len práva v matici - obmedzuje sa mu
 * rovno to, na ktoré adresy sa vôbec dostane. HR by inak mal, lebo `hr.access`
 * dostáva každá rola automaticky.
 *
 * Zoznam je krátky zámerne: vyskladnenie, vlastný profil (bez neho by sa
 * portál nemal ako vykresliť) a prihlásenie. Nič iné.
 */
const KIOSK_PATHS = [
  '/api/warehouse/withdrawals',
  '/api/admin/me',
  '/api/auth/'
];

function kioskMayReach(req) {
  // `originalUrl`, nie `path`: to druhé je vo vnútri routera orezané o miesto,
  // kde je router pripojený, a zoznam by porovnával polovicu adresy.
  const path = (req.originalUrl || '').split('?')[0];
  return KIOSK_PATHS.some((allowed) => path.startsWith(allowed));
}

/**
 * Middleware to verify Azure AD / Teams token, or a local sign-in token
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

    // Somebody who signed in with an e-mail and a password rather than M365.
    // The lookup inside also confirms the account is still switched on, so
    // disabling a supplier takes effect at once instead of when their token
    // happens to expire.
    if (isLocalToken(token)) {
      const localUser = await localAuth.verifyLocalToken(token);
      if (!localUser) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired session' });
      }
      req.user = localUser;
      if (localUser.isKiosk && !kioskMayReach(req)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Účet tabletu smie len vyskladnenie'
        });
      }
      return next();
    }

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
          logger.warn('Token verification failed', { error: err.message });
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
    logger.error('Auth middleware error', { error: error.message });
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

    // Same two kinds as verifyToken. Left out here, a locally signed-in user
    // would look anonymous to every route using optional auth - not a hole,
    // but a difference between the two paths that nobody would expect.
    if (isLocalToken(token)) {
      const localUser = await localAuth.verifyLocalToken(token);
      if (localUser) req.user = localUser;
      // Zámok tabletu platí aj tu. Časť modulu HR stojí na `optionalAuth` a
      // bez tohto by sa tablet na tie adresy dostal - a práve tam by mu to
      // `hr.access`, ktoré má automaticky každá rola, aj povolilo.
      if (localUser?.isKiosk && !kioskMayReach(req)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Účet tabletu smie len vyskladnenie'
        });
      }
      return next();
    }

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
