const sql = require('mssql');
const logger = require('../utils/logger');

/**
 * Read-only client for the SOFTIP PAM (PROFIT) database.
 *
 * SQL Server 2019 na ETILOGSAP2, inštancia PROFIT, port 1435, databáza
 * Profit. Dostupná cez ten istý VPN tunel, ktorým sa chodí do SAPu.
 *
 * DO PAM NIKDY NEZAPISUJEME. Rovnaká zásada ako pri SAPe, ale tu ju držia
 * dva nezávislé zámky:
 *
 *   V databáze. Účet etilog_portal_ro je v role db_denydatawriter a má
 *   GRANT SELECT len na štyri tabuľky, z toho z_identifikacia a
 *   z_vysl_brutto len po vybraných stĺpcoch. Mzdy (vysb_koruny) ani rodné
 *   čísla (ido_rod_cis) sa cez tento účet prečítať nedajú - overené
 *   priamym prihlásením, nie predpokladom. Toto je ten hlavný zámok: platí
 *   aj vtedy, keď sa pomýlim v kóde.
 *
 *   Tu. `query()` pustí len SELECT alebo WITH a odmietne bodkočiarku, teda
 *   aj druhý príkaz prilepený za prvý. Je to poistka, nie obrana - keby
 *   niekto raz tomu účtu omylom pridal práva, nech to zastaví ešte aj kód.
 *
 * Parametre sa posielajú cez request.input(), nikdy skladaním reťazca.
 *
 * Spojenie sa nadväzuje až pri prvom dotaze. Keď je VPN dole alebo PAM
 * vypnutý, appka sa kvôli tomu nesmie ani spomaliť pri štarte, ani spadnúť.
 */

const HOST = process.env.PAM_DB_HOST || '';
const PORT = Number(process.env.PAM_DB_PORT || 1435);
const DATABASE = process.env.PAM_DB_NAME || 'Profit';
const USER = process.env.PAM_DB_USER || '';
const PASSWORD = process.env.PAM_DB_PASSWORD || '';
const TIMEOUT_MS = Number(process.env.PAM_DB_TIMEOUT_MS || 15000);

// Vnútorný server so self-signed certifikátom, dostupný len cez VPN tunel na
// známu adresu. Šifrujeme, ale reťaz neoveruje nikto - rovnaká situácia ako
// pri SAPe. Keby Softip certifikát raz vydal poriadne, stačí prepnúť na false.
const TRUST_CERT = String(process.env.PAM_DB_TRUST_CERT || 'true').toLowerCase() === 'true';

/** Len na čítanie: čokoľvek iné než SELECT/WITH sem nemá čo robiť. */
const READ_ONLY = /^\s*(SELECT|WITH)\b/i;

class PamError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = 'PamError';
    this.cause = cause;
  }
}

class PamClient {
  constructor() {
    this.pool = null;
    this.connecting = null;
  }

  /** Why the client cannot run, or null when it can. */
  static get misconfigured() {
    const missing = [
      ['PAM_DB_HOST', HOST],
      ['PAM_DB_USER', USER],
      ['PAM_DB_PASSWORD', PASSWORD]
    ].filter(([, value]) => !value).map(([name]) => name);

    return missing.length ? `missing ${missing.join(', ')}` : null;
  }

  static get configured() {
    return PamClient.misconfigured === null;
  }

  /**
   * Kam sa pripájame - bez hesla.
   *
   * Používa to /health a chybové hlásenia. Heslo sa odtiaľto nedostane ani
   * do logu, ani na obrazovku.
   */
  static get target() {
    return { host: HOST, port: PORT, database: DATABASE, user: USER };
  }

  /**
   * Pripojenie sa nadväzuje lenivo a len raz.
   *
   * `connecting` drží rozrobený pokus, aby dva súbežné dotazy neotvorili dva
   * poolu. Pri neúspechu sa zahodí, takže ďalší dotaz to skúsi odznova -
   * inak by jedno zlyhanie pri štarte VPN zablokovalo synchronizáciu až do
   * reštartu appky.
   */
  async #connect() {
    if (this.pool?.connected) return this.pool;
    if (this.connecting) return this.connecting;

    const reason = PamClient.misconfigured;
    if (reason) throw new PamError(`PAM is not configured: ${reason}`);

    this.connecting = (async () => {
      const pool = new sql.ConnectionPool({
        server: HOST,
        port: PORT,
        database: DATABASE,
        user: USER,
        password: PASSWORD,
        options: {
          encrypt: true,
          trustServerCertificate: TRUST_CERT,
          // Bez tohto vracia tedious dátumy posunuté o časové pásmo procesu.
          // Nás zaujímajú kalendárne dni, nie okamihy.
          useUTC: false
        },
        connectionTimeout: TIMEOUT_MS,
        requestTimeout: TIMEOUT_MS,
        pool: { max: 2, min: 0, idleTimeoutMillis: 60000 }
      });

      // Pool si chyby hlási sám; bez poslucháča by neodchytená chyba zhodila
      // celý proces, a to kvôli databáze, bez ktorej appka vie fungovať.
      pool.on('error', (error) => {
        logger.warn('PAM pool error', { error: error.message });
      });

      await pool.connect();
      this.pool = pool;
      return pool;
    })();

    try {
      return await this.connecting;
    } catch (error) {
      this.pool = null;
      throw new PamError(`PAM connection failed: ${error.message}`, error);
    } finally {
      this.connecting = null;
    }
  }

  /**
   * Jeden SELECT s pomenovanými parametrami.
   *
   * `params` je objekt { meno: hodnota }; v SQL sa naň odkazuje ako @meno.
   * Hodnoty sa nikdy nevkladajú do textu dotazu.
   */
  async query(text, params = {}) {
    if (!READ_ONLY.test(text)) {
      throw new PamError('PAM client refuses anything but SELECT');
    }
    if (text.includes(';')) {
      throw new PamError('PAM client refuses a batch of statements');
    }

    const pool = await this.#connect();
    const request = pool.request();
    for (const [name, value] of Object.entries(params)) {
      request.input(name, value);
    }

    try {
      const result = await request.query(text);
      return result.recordset || [];
    } catch (error) {
      throw new PamError(`PAM query failed: ${error.message}`, error);
    }
  }

  /**
   * Odpovedá PAM? Odpoveď nesie aj čas, lebo pri VPN je pomaly to isté
   * ako nedostupne a na /health sa to má dať rozlíšiť.
   */
  async probe() {
    const started = Date.now();
    try {
      const rows = await this.query('SELECT TOP (1) osu_os_cis AS ok FROM dbo.z_identifikacia');
      return { ok: rows.length > 0, ms: Date.now() - started, ...PamClient.target };
    } catch (error) {
      return { ok: false, ms: Date.now() - started, error: error.message, ...PamClient.target };
    }
  }

  async close() {
    const pool = this.pool;
    this.pool = null;
    if (pool) await pool.close().catch(() => {});
  }

  /** Jeden klient na celú appku. */
  static shared() {
    if (!PamClient._shared) PamClient._shared = new PamClient();
    return PamClient._shared;
  }
}

module.exports = { PamClient, PamError };
