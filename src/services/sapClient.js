const https = require('https');
const logger = require('../utils/logger');

/**
 * Read-only client for the SAP Business One Service Layer.
 *
 * Reachable over the OpenVPN tunnel the host already holds, at
 * https://<host>:50000/b1s/v1. Login is a POST that returns two cookies -
 * B1SESSION and ROUTEID, both required, the second for load-balancer affinity -
 * and the session lasts 30 minutes.
 *
 * WE NEVER WRITE TO SAP. That is a hard requirement, so it is enforced here
 * rather than trusted to discipline: `get()` is the only way to reach business
 * data and it cannot send anything but GET, and `#call()` refuses a non-GET
 * method for any path other than /Login and /Logout, which create and destroy a
 * session and touch no document, item or stock. There is no code path in this
 * file that can create, change or delete anything in SAP.
 *
 * Two things about the transport were learned the hard way against the real
 * server and are not decoration:
 *
 *   The certificate is self-signed and expired, so it is pinned by SHA-256
 *   fingerprint instead of verified by a chain - we accept exactly one
 *   certificate and nothing else, which is stricter than a chain check. When it
 *   is reissued, set SAP_VERIFY_TLS=true and drop the pin; the code needs no
 *   change.
 *
 *   TLS session caching is off. On a resumed session the server does not resend
 *   its certificate, getPeerCertificate() comes back empty and the pin check
 *   fails on a connection that is in fact fine - which looks like a random
 *   outage once every few requests.
 */

const ENABLED = String(process.env.SAP_ENABLED || 'false').toLowerCase() === 'true';
const HOST = process.env.SAP_HOST || '';
const PORT = Number(process.env.SAP_PORT || 50000);
const COMPANY_DB = process.env.SAP_DB || '';
const USERNAME = process.env.SAP_USER || '';
const PASSWORD = process.env.SAP_PASSWORD || '';
const FINGERPRINT = String(process.env.SAP_FINGERPRINT || '').toUpperCase();
const VERIFY_TLS = String(process.env.SAP_VERIFY_TLS || 'false').toLowerCase() === 'true';
const TIMEOUT_MS = Number(process.env.SAP_TIMEOUT_MS || 30000);

const BASE = '/b1s/v1';
const LOGIN = `${BASE}/Login`;
const LOGOUT = `${BASE}/Logout`;
const SESSION_PATHS = new Set([LOGIN, LOGOUT]);

// The server drops a session after 30 minutes idle; renew a few minutes early
// rather than discover it mid-pass.
const SESSION_TTL_MS = 25 * 60 * 1000;

// The Service Layer pages at 20 rows regardless of $top, so every list is read
// with $skip until a short page comes back.
const PAGE_SIZE = 20;

/** Thrown for anything the caller might want to distinguish from a bug. */
class SapError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'SapError';
    this.status = status;
  }
}

class SapClient {
  constructor() {
    this.cookies = [];
    this.sessionAt = 0;
    this.calls = 0;

    // keepAlive so a sync pass reuses one connection; maxCachedSessions: 0 so
    // every connection still does a full handshake and the pin is checkable.
    this.agent = new https.Agent({
      keepAlive: true,
      maxCachedSessions: 0,
      maxSockets: 4
    });
  }

  static get enabled() {
    return ENABLED;
  }

  /** Why the client cannot run, or null when it can. */
  static get misconfigured() {
    if (!ENABLED) return 'SAP_ENABLED is false';
    const missing = [
      ['SAP_HOST', HOST],
      ['SAP_DB', COMPANY_DB],
      ['SAP_USER', USERNAME],
      ['SAP_PASSWORD', PASSWORD]
    ].filter(([, value]) => !value).map(([name]) => name);

    if (missing.length) return `missing ${missing.join(', ')}`;
    if (!VERIFY_TLS && !FINGERPRINT) return 'missing SAP_FINGERPRINT (or set SAP_VERIFY_TLS=true)';
    return null;
  }

  /**
   * Why this client cannot run, or null when it can.
   *
   * The instance form exists so callers ask the client they were handed rather
   * than the class: a test double or a second connection has its own answer,
   * and consulting the static here would make the service consult the
   * environment instead of its own dependency.
   */
  get unavailable() {
    return SapClient.misconfigured;
  }

  /** HTTP calls made since the counter was last reset - for the sync log. */
  get callCount() {
    return this.calls;
  }

  resetCallCount() {
    this.calls = 0;
  }

  // ------------------------------------------------------------------ transport

  /**
   * The one place a request is made, and the one place a method is chosen.
   *
   * Private on purpose: everything outside this file goes through get(), which
   * cannot ask for anything but GET.
   */
  #call(path, { method = 'GET', body = null, withSession = true } = {}) {
    const isSession = SESSION_PATHS.has(path.split('?')[0]);

    if (!isSession && method !== 'GET') {
      throw new SapError(`Refused ${method} ${path}: this client only reads from SAP`);
    }
    if (isSession && method !== 'POST') {
      throw new SapError(`Refused ${method} ${path}`);
    }

    this.calls += 1;

    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const request = https.request(
        {
          host: HOST,
          port: PORT,
          path: encodeURI(path),
          method,
          agent: this.agent,
          timeout: TIMEOUT_MS,
          // The pin below is what authenticates the server while the
          // certificate is expired and self-signed. Once it is reissued,
          // SAP_VERIFY_TLS=true switches this to an ordinary chain check.
          rejectUnauthorized: VERIFY_TLS,
          headers: {
            Accept: 'application/json',
            ...(payload
              ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
              }
              : {}),
            ...(withSession && this.cookies.length ? { Cookie: this.cookies.join('; ') } : {})
          }
        },
        (response) => {
          let raw = '';
          response.on('data', (chunk) => { raw += chunk; });
          response.on('end', () => resolve({
            status: response.statusCode,
            raw,
            setCookie: response.headers['set-cookie'] || []
          }));
        }
      );

      if (!VERIFY_TLS) {
        request.on('socket', (socket) => {
          socket.on('secureConnect', () => {
            const actual = String(socket.getPeerCertificate().fingerprint256 || '').toUpperCase();
            // Empty means the session was resumed and no certificate was sent.
            // maxCachedSessions: 0 should prevent that; if it happens anyway,
            // refusing is the safe direction.
            if (actual !== FINGERPRINT) {
              request.destroy(new SapError(
                `SAP certificate does not match the pin (got ${actual || 'nothing'})`
              ));
            }
          });
        });
      }

      request.on('timeout', () => request.destroy(new SapError(`SAP timed out after ${TIMEOUT_MS} ms`)));
      request.on('error', reject);
      if (payload) request.write(payload);
      request.end();
    });
  }

  // -------------------------------------------------------------------- session

  async #ensureSession() {
    const reason = SapClient.misconfigured;
    if (reason) throw new SapError(`SAP is not configured: ${reason}`);

    if (this.cookies.length && Date.now() - this.sessionAt < SESSION_TTL_MS) return;

    const response = await this.#call(LOGIN, {
      method: 'POST',
      withSession: false,
      body: { CompanyDB: COMPANY_DB, UserName: USERNAME, Password: PASSWORD }
    });

    if (response.status !== 200) {
      // Never log the body: a failed login can echo the payload back.
      throw new SapError(`SAP login failed (${response.status})`, response.status);
    }

    // Both cookies matter. B1SESSION identifies the session; ROUTEID pins it to
    // the node that owns it, and without it a load-balanced setup answers 401
    // intermittently.
    this.cookies = (response.setCookie || []).map((cookie) => cookie.split(';')[0]);
    if (!this.cookies.length) {
      throw new SapError('SAP login returned no session cookie');
    }
    this.sessionAt = Date.now();

    logger.debug('SAP session opened', { host: HOST, db: COMPANY_DB, cookies: this.cookies.length });
  }

  async logout() {
    if (!this.cookies.length) return;
    try {
      await this.#call(LOGOUT, { method: 'POST', body: {} });
    } catch (error) {
      // A session we cannot close expires by itself in half an hour.
      logger.debug('SAP logout failed, letting the session expire', { error: error.message });
    } finally {
      this.cookies = [];
      this.sessionAt = 0;
    }
  }

  // ----------------------------------------------------------------- reading

  /**
   * Read one path under /b1s/v1. The only way this client touches business data.
   *
   * `path` is relative and without the base, e.g. `Items('FG100827')`. Retries
   * once on 401, because a session can lapse between two calls of a long pass
   * and re-logging in is cheaper than failing the whole sync.
   */
  async get(path, { retry = true } = {}) {
    await this.#ensureSession();

    const response = await this.#call(`${BASE}/${path.replace(/^\/+/, '')}`);

    if (response.status === 401 && retry) {
      this.cookies = [];
      this.sessionAt = 0;
      return this.get(path, { retry: false });
    }

    if (response.status !== 200) {
      throw new SapError(`SAP GET ${path} returned ${response.status}`, response.status);
    }

    try {
      return JSON.parse(response.raw);
    } catch {
      throw new SapError(`SAP GET ${path} returned a body that is not JSON`);
    }
  }

  /** Like get(), but null instead of throwing on 404 - a missing BOM is normal. */
  async getOrNull(path) {
    try {
      return await this.get(path);
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  /**
   * Read a collection to the end, or until `max` rows.
   *
   * The Service Layer ignores a large $top and pages at 20, so this walks $skip
   * and stops on the first short page.
   */
  async list(path, { max = 2000 } = {}) {
    const rows = [];
    const joiner = path.includes('?') ? '&' : '?';

    for (let skip = 0; skip < max; skip += PAGE_SIZE) {
      const page = await this.get(`${path}${joiner}$skip=${skip}&$top=${PAGE_SIZE}`);
      const value = (page && page.value) || [];
      rows.push(...value);
      if (value.length < PAGE_SIZE) break;
    }

    return rows.slice(0, max);
  }

  /**
   * Fetch many items in as few calls as possible.
   *
   * One `$filter` of OR'd codes per 20 items - the same page size, so each batch
   * is one round trip. Codes SAP does not know are simply absent from the
   * result; the caller decides what that means.
   */
  async itemsByCode(codes, select) {
    const wanted = [...new Set(codes)].filter(Boolean);
    const found = new Map();

    for (let i = 0; i < wanted.length; i += PAGE_SIZE) {
      const batch = wanted.slice(i, i + PAGE_SIZE);
      const filter = batch.map((code) => `ItemCode eq '${code.replace(/'/g, "''")}'`).join(' or ');
      const page = await this.get(`Items?$select=${select}&$filter=${filter}&$top=${PAGE_SIZE}`);
      for (const row of (page && page.value) || []) found.set(row.ItemCode, row);
    }

    return found;
  }
}

module.exports = { SapClient, SapError };
