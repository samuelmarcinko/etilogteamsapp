const cron = require('node-cron');

const pool = require('../database/config');
const { SapClient } = require('./sapClient');
const SystemSettings = require('../database/models/SystemSettings');
const logger = require('../utils/logger');

/**
 * Skladový modul napojený na SAP.
 *
 * Skladníci zadávali počty ručne, lebo ich nemali odkiaľ vziať. SAP ich vie -
 * pre sklad 02-03, čo je presne tá hala, ktorú tento modul eviduje. Odtiaľ sa
 * teda berú.
 *
 * Deľba práce, z ktorej všetko ostatné vyplýva:
 *
 *   SAP vie, KOĽKO toho je.
 *   Portál vie, KDE to leží.
 *
 * SAP o paletových miestach nevie nič a vedieť nebude. Preto sa rozdelenie
 * tovaru po paletách neprepisuje - s jedinou výnimkou, ktorá nie je dohadom:
 * ak materiál leží na jednej jedinej pozícii, tak počet zo SAPu JE počet na tej
 * palete. Pri dvoch a viac by sa muselo hádať, z ktorej ubudlo, a hádanie, ktoré
 * vyzerá ako údaj, je horšie než priznaný rozpor.
 *
 * Zo SAPu sa iba číta. Jediné volanie je GET /Items; `sapClient` navyše každú
 * inú metódu než GET odmietne pre všetky cesty okrem /Login a /Logout, takže
 * zapísať do SAPu sa nedá ani omylom.
 */

// Sklad, ktorý táto appka eviduje. Nie odhad: potvrdil ho skladník a nezávisle
// aj dáta - proti 02-03 sedelo 39 kódov presne, proti 02-02 ani jeden.
const WAREHOUSE = process.env.WAREHOUSE_SAP_STORE || '02-03';

// Pred rannou a pred poobednou zmenou. Nie o polnoci, keď to nikto nečíta, a
// nie každú hodinu, keď sa sklad tak často nemení.
const SCHEDULE = process.env.WAREHOUSE_SYNC_CRON || '30 5,13 * * *';

const FIELDS = 'ItemCode,ItemName,InventoryUOM,ItemWarehouseInfoCollection';

/**
 * Prepisovať aj `quantity` a jednopozičné rozpisy, alebo zatiaľ len
 * zaznamenávať, čo SAP hovorí?
 *
 * Vypnuté, kým to skladník na obrazovke neuvidí. Ťahať čísla a potichu nimi
 * prepísať to, čo tam niekto napísal rukou, skôr než sa vôbec dá zistiť odkiaľ
 * sa vzali, je najrýchlejší spôsob, ako o modul stratiť dôveru.
 */
const APPLY_SETTING = 'warehouse.sync.apply';

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

class WarehouseSyncService {
  constructor(client = null) {
    // Zdieľa sa session so SAP mirrorom výrobného plánu - SAP počíta prihlásenia
    // a druhá inštancia by sa prihlasovala zbytočne druhýkrát.
    this.client = client || require('./sapSyncService').shared().client;
    this.cronJob = null;
    this.isRunning = false;
    this.inFlight = false;
  }

  /** Zapína sa prepisovanie počtov? */
  static async applyEnabled() {
    return (await SystemSettings.get(APPLY_SETTING)) === 'true';
  }

  static async setApplyEnabled(enabled) {
    await SystemSettings.set(APPLY_SETTING, enabled ? 'true' : 'false');
    return enabled;
  }

  /**
   * Jedna položka zo SAPu, pre formulár „pridať materiál".
   *
   * Skladník kód nepíše, ale vyhľadá - takže preklep, ktorý sa v SAPe nenájde,
   * sa do evidencie nedostane. Presne takto tam pribudlo `FG00875` s chýbajúcou
   * nulou.
   *
   * Vracia sa aj položka, na ktorej má SAP v 02-03 nulu: na palete môže ležať
   * tovar, ktorý ešte nie je prijatý. Že je to nula, sa povie - nezamlčí.
   */
  async lookup(code) {
    const wanted = String(code || '').trim().toUpperCase();
    if (wanted.length < 3) return null;

    const found = await this.client.itemsByCode([wanted], FIELDS);
    const item = found.get(wanted);
    if (!item) return null;

    const perWarehouse = (item.ItemWarehouseInfoCollection || [])
      .filter((w) => num(w.InStock) !== 0)
      .map((w) => ({ warehouse: w.WarehouseCode, inStock: num(w.InStock) }))
      .sort((a, b) => b.inStock - a.inStock);

    const here = (item.ItemWarehouseInfoCollection || [])
      .find((w) => w.WarehouseCode === WAREHOUSE);

    return {
      code: item.ItemCode,
      name: item.ItemName || null,
      uom: item.InventoryUOM || 'ks',
      warehouse: WAREHOUSE,
      quantity: num(here?.InStock),
      // Kde inde tá položka leží. Keď je v 02-03 nula a inde nie, je to prvá
      // otázka, ktorú si skladník položí - tak nech ju má rovno pred sebou.
      elsewhere: perWarehouse.filter((w) => w.warehouse !== WAREHOUSE)
    };
  }

  /** Posledný beh, pre stavový riadok a pre otázku „kedy naposledy?". */
  static async lastRun() {
    const { rows } = await pool.query(
      `SELECT id, started_at, finished_at, duration_ms, warehouse, codes, matched,
              unknown, changed, http_calls, applied, triggered_by, ok, error
         FROM warehouse_sync_log
        ORDER BY started_at DESC
        LIMIT 1`
    );
    return rows[0] || null;
  }

  // ------------------------------------------------------------------ čítanie

  /**
   * Kódy, ktoré sa majú pýtať SAPu.
   *
   * Len to, čo je práve teraz v Evidencii materiálov - zmazané položky nie,
   * rovnaká podmienka akú má `Material.findAll`. Riadok s prázdnym
   * `sap_item_code` je zámerne odpojený a preskakuje sa.
   */
  async #codes() {
    const { rows } = await pool.query(
      `SELECT DISTINCT sap_item_code AS code
         FROM materials
        WHERE deleted_at IS NULL AND sap_item_code IS NOT NULL AND sap_item_code <> ''
        ORDER BY code`
    );
    return rows.map((row) => row.code);
  }

  /** Zásoba v 02-03, po dvadsiatich kódoch naraz. Iba GET. */
  async #stock(codes) {
    const found = await this.client.itemsByCode(codes, FIELDS);

    const stock = new Map();
    for (const [code, item] of found) {
      const row = (item.ItemWarehouseInfoCollection || [])
        .find((w) => w.WarehouseCode === WAREHOUSE);

      stock.set(code, {
        // Položka, ktorú SAP pozná, ale v 02-03 na nej nemá nič, je nula - nie
        // neznáma. To sú dve rôzne odpovede a nesmú splynúť.
        quantity: num(row?.InStock),
        name: item.ItemName || null,
        uom: item.InventoryUOM || null
      });
    }
    return stock;
  }

  // ------------------------------------------------------------------ zápis

  /**
   * Jeden prechod.
   *
   * `apply` rozhoduje, či sa prepíšu aj počty. Bez neho sa zapíšu len stĺpce
   * `sap_*`, ktoré dnes nikto nevidí - takže prvé behy sa dajú prezrieť skôr,
   * než čokoľvek zmenia.
   */
  async runOnce({ apply = null, triggeredBy = null } = {}) {
    if (this.inFlight) {
      return { skipped: 'už beží' };
    }
    this.inFlight = true;

    const started = Date.now();
    const callsBefore = this.client.callCount || 0;
    const writeQuantities = apply === null ? await WarehouseSyncService.applyEnabled() : apply;

    let logId = null;
    try {
      const { rows } = await pool.query(
        `INSERT INTO warehouse_sync_log (warehouse, applied, triggered_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [WAREHOUSE, writeQuantities, triggeredBy]
      );
      logId = rows[0].id;

      const codes = await this.#codes();
      if (!codes.length) {
        await this.#finish(logId, started, callsBefore, {
          codes: 0, matched: 0, unknown: 0, changed: 0, before: [], ok: true
        });
        return { codes: 0, matched: 0, unknown: 0, changed: 0 };
      }

      const stock = await this.#stock(codes);
      const result = await this.#write(stock, writeQuantities);

      await this.#finish(logId, started, callsBefore, {
        codes: codes.length,
        matched: stock.size,
        unknown: codes.length - stock.size,
        changed: result.changed,
        before: result.before,
        ok: true
      });

      logger.info('Warehouse SAP sync complete', {
        warehouse: WAREHOUSE, codes: codes.length, matched: stock.size,
        changed: result.changed, applied: writeQuantities
      });

      return { codes: codes.length, matched: stock.size, unknown: codes.length - stock.size, ...result };
    } catch (error) {
      logger.error('Warehouse SAP sync failed', { error: error.message });
      if (logId) {
        await this.#finish(logId, started, callsBefore, {
          codes: 0, matched: 0, unknown: 0, changed: 0, before: [], ok: false, error: error.message
        }).catch(() => {});
      }
      throw error;
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Zápis do materiálov.
   *
   * Jedna transakcia: buď sa zapíše celý prechod, alebo nič. Polovičný prechod
   * by nechal sklad v stave, o ktorom nikto nevie, ktorá časť je nová.
   */
  async #write(stock, writeQuantities) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: materials } = await client.query(
        `SELECT m.id, m.code, m.sap_item_code, m.quantity,
                (SELECT count(*)::int FROM material_placements mp WHERE mp.material_id = m.id) AS placements,
                (SELECT mp.id FROM material_placements mp WHERE mp.material_id = m.id LIMIT 1) AS placement_id,
                (SELECT mp.quantity FROM material_placements mp WHERE mp.material_id = m.id LIMIT 1) AS placement_qty
           FROM materials m
          WHERE m.deleted_at IS NULL AND m.sap_item_code IS NOT NULL AND m.sap_item_code <> ''
          FOR UPDATE OF m`
      );

      const before = [];
      let changed = 0;

      for (const material of materials) {
        const sap = stock.get(material.sap_item_code);

        // SAP kód nepozná: zaznamená sa práve to, a počet sa nechá na pokoji.
        // Prepísať ho nulou by znamenalo tvrdiť, že tam nič nie je - a SAP
        // netvrdí nič, on o tej položke nevie.
        if (!sap) {
          await client.query(
            `UPDATE materials
                SET sap_known = FALSE, sap_quantity = NULL, sap_synced_at = CURRENT_TIMESTAMP
              WHERE id = $1`,
            [material.id]
          );
          continue;
        }

        await client.query(
          `UPDATE materials
              SET sap_known = TRUE, sap_quantity = $2, sap_name = $3, sap_uom = $4,
                  sap_synced_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [material.id, sap.quantity, sap.name, sap.uom]
        );

        if (!writeQuantities) continue;
        if (num(material.quantity) === sap.quantity) continue;

        // Odtiaľto sa mení to, čo skladník vidí - takže sa najprv zapíše, ako
        // to vyzeralo predtým.
        before.push({
          id: material.id,
          code: material.code,
          quantity: num(material.quantity),
          placementId: material.placements === 1 ? material.placement_id : null,
          placementQuantity: material.placements === 1 ? num(material.placement_qty) : null
        });

        await client.query(
          `UPDATE materials SET quantity = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [material.id, Math.round(sap.quantity)]
        );

        // Jedna pozícia: nie je čo domýšľať, celok JE obsah tej palety.
        // Viac pozícií: rozpis sa nechá tak, ako ho zadal človek, a rozpor
        // uvidí na obrazovke. Rozdeliť rozdiel medzi palety by bola výmysel.
        if (material.placements === 1) {
          await client.query(
            'UPDATE material_placements SET quantity = $2 WHERE id = $1',
            [material.placement_id, Math.max(0, Math.round(sap.quantity))]
          );
        }

        changed += 1;
      }

      await client.query('COMMIT');
      return { changed, before };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async #finish(logId, started, callsBefore, result) {
    await pool.query(
      `UPDATE warehouse_sync_log
          SET finished_at = CURRENT_TIMESTAMP, duration_ms = $2,
              codes = $3, matched = $4, unknown = $5, changed = $6,
              http_calls = $7, before_state = $8, ok = $9, error = $10
        WHERE id = $1`,
      [
        logId, Date.now() - started,
        result.codes, result.matched, result.unknown, result.changed,
        Math.max(0, (this.client.callCount || 0) - callsBefore),
        JSON.stringify(result.before || []),
        result.ok, result.error || null
      ]
    );
  }

  /**
   * Vrátiť jeden beh.
   *
   * Prehrá `before_state` späť. Toto je návratová cesta pre počty - nie obnova
   * zálohy, ktorá by zahodila aj všetko ostatné, čo sa medzitým v portáli
   * stalo.
   */
  static async revert(logId) {
    const { rows } = await pool.query(
      'SELECT before_state, applied FROM warehouse_sync_log WHERE id = $1', [logId]
    );
    const log = rows[0];
    if (!log) return { notFound: true };
    if (!log.applied || !Array.isArray(log.before_state) || !log.before_state.length) {
      return { restored: 0, reason: 'tento beh počty nemenil' };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of log.before_state) {
        await client.query(
          'UPDATE materials SET quantity = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
          [row.id, row.quantity]
        );
        if (row.placementId != null) {
          await client.query(
            'UPDATE material_placements SET quantity = $2 WHERE id = $1',
            [row.placementId, row.placementQuantity]
          );
        }
      }
      await client.query('COMMIT');
      return { restored: log.before_state.length };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  start() {
    if (this.isRunning) return;

    const reason = this.client.unavailable;
    if (reason) {
      logger.info('Warehouse SAP sync not started', { reason });
      return;
    }

    this.cronJob = cron.schedule(SCHEDULE, () => {
      this.runOnce().catch(() => {});
    });
    this.isRunning = true;

    logger.info('Warehouse SAP sync started', {
      warehouse: WAREHOUSE, schedule: SCHEDULE, readOnly: true
    });
    // Zámerne bez behu pri štarte: sklad sa nemení každým reštartom appky a
    // prechod pri každom nasadení by len robil hluk v logu.
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    this.isRunning = false;
  }
}

let shared = null;

/** Jedna inštancia pre cron aj pre tlačidlo, nech si nelezú do cesty. */
WarehouseSyncService.shared = () => {
  if (!shared) shared = new WarehouseSyncService();
  return shared;
};

WarehouseSyncService.WAREHOUSE = WAREHOUSE;
WarehouseSyncService.SCHEDULE = SCHEDULE;

module.exports = WarehouseSyncService;
