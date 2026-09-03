const cron = require('node-cron');
const pool = require('../database/config');
const logger = require('../utils/logger');
const { SapClient } = require('./sapClient');
const {
  KIND,
  RES_SEWING,
  RES_CUTTING,
  CONTAINER_GROUP,
  projectTypeOf,
  isSkippableLine,
  classifyComponent
} = require('./sapClassifier');

/**
 * Copies what the plan needs out of SAP and into our own tables.
 *
 * The calendar never calls SAP. It reads this mirror, which means the plan keeps
 * working when the VPN drops or SAP is down - the availability check just says
 * how old its data is. That is the whole reason this service exists; a check
 * that goes blank in the middle of a shift is worse than none.
 *
 * One pass reads, in this order:
 *   the item groups, for their names
 *   open production orders - Planned and Released, with something left to make
 *   for the orders on finished goods, the BOM two levels deep
 *   every item touched, with its stock
 *
 * Two levels because that is where constructions and bags live. Sewing is
 * looked for deeper than that, but only as a yes/no - see hasSewingBelow.
 *
 * Writes are one transaction per pass and replace the mirror wholesale, so a
 * reader sees either the previous pass or this one, never half of each. A failed
 * pass writes nothing and leaves the last good copy in place.
 *
 * sap_item_kinds is the exception: it carries the planner's own decisions about
 * what is a construction and what is a bag, so this service only ever fills in
 * rows it guessed itself and never touches a manual one.
 */

const SYNC_MINUTES = Number(process.env.SAP_SYNC_MINUTES || 15);

// Orders to read per pass. There are around 450 open at any time, most of them
// on sub-assemblies; the cap is a guard against a runaway, not a target.
const MAX_ORDERS = Number(process.env.SAP_MAX_ORDERS || 1200);

// How deep to go looking for the sewing resource. Level 1 and 2 are stored;
// this only decides how far down "is there sewing under here" may look. In
// FG100790 the sewing sits two levels below the bag group, so one is not enough.
const SEWING_DEPTH = 4;

const FINISHED_GOODS_GROUP = 102;

const ORDER_FIELDS = [
  'AbsoluteEntry', 'ItemNo', 'ProductDescription', 'PlannedQuantity',
  'CompletedQuantity', 'ProductionOrderStatus', 'Warehouse', 'StartDate', 'DueDate'
].join(',');

const ITEM_FIELDS = [
  'ItemCode', 'ItemName', 'ItemsGroupCode', 'ProcurementMethod', 'InventoryItem',
  'InventoryUOM', 'QuantityOnStock', 'QuantityOrderedFromVendors', 'ItemWarehouseInfoCollection'
].join(',');

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const day = (value) => {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

class SapSyncService {
  constructor(client = new SapClient()) {
    this.client = client;
    this.cronJob = null;
    this.isRunning = false;
    this.inFlight = false;
  }

  /** The last pass, for the admin status endpoint. */
  static async lastRun() {
    const { rows } = await pool.query(
      `SELECT started_at, finished_at, duration_ms, orders, items, bom_lines,
              http_calls, ok, error
         FROM sap_sync_log
        ORDER BY started_at DESC
        LIMIT 1`
    );
    return rows[0] || null;
  }

  // --------------------------------------------------------------- reading SAP

  /**
   * Everything one pass needs, gathered in memory before anything is written.
   *
   * Nothing here touches the database: a read that half-fails must not leave a
   * half-written mirror.
   */
  async collect() {
    const groups = new Map();
    for (const row of await this.client.list('ItemGroups?$select=Number,GroupName', { max: 200 })) {
      groups.set(Number(row.Number), row.GroupName);
    }

    const open = (await this.client.list(
      `ProductionOrders?$select=${ORDER_FIELDS}&$orderby=AbsoluteEntry desc`,
      { max: MAX_ORDERS }
    )).filter((order) => {
      const status = order.ProductionOrderStatus;
      const remaining = num(order.PlannedQuantity) - num(order.CompletedQuantity);
      return (status === 'boposPlanned' || status === 'boposReleased') && remaining > 0;
    });

    // The order's own item tells us whether it is a finished good (the planner
    // picks from those) or a sub-assembly (those are the evidence that a bag is
    // already being made). 94% are sub-assemblies.
    const items = new Map();
    const trees = new Map();
    await this.#loadItems(open.map((order) => order.ItemNo), items);

    const finishedGoods = open.filter((order) => {
      const item = items.get(order.ItemNo);
      return item && Number(item.ItemsGroupCode) === FINISHED_GOODS_GROUP;
    });

    // Level 1 and 2 of each finished good.
    const bomLines = [];
    for (const order of finishedGoods) {
      const tree = await this.#tree(order.ItemNo, trees);
      if (!tree) continue;

      const level1 = (tree.ProductTreeLines || []);
      await this.#loadItems(level1.map((line) => line.ItemCode), items);
      bomLines.push(...this.#linesOf(order.ItemNo, tree));

      for (const line of level1) {
        if (isSkippableLine(this.#asLine(line))) continue;
        const item = items.get(line.ItemCode);
        if (!item || item.ProcurementMethod !== 'bom_Make') continue;

        const sub = await this.#tree(line.ItemCode, trees);
        if (!sub) continue;
        await this.#loadItems((sub.ProductTreeLines || []).map((x) => x.ItemCode), items);
        bomLines.push(...this.#linesOf(line.ItemCode, sub));
      }
    }

    return { groups, open, finishedGoods, items, trees, bomLines };
  }

  async #loadItems(codes, into) {
    const wanted = [...new Set(codes)].filter((code) => code && !into.has(code));
    if (!wanted.length) return;
    const found = await this.client.itemsByCode(wanted, ITEM_FIELDS);
    for (const code of wanted) into.set(code, found.get(code) || null);
  }

  async #tree(code, cache) {
    if (cache.has(code)) return cache.get(code);
    const tree = await this.client.getOrNull(`ProductTrees('${code}')`);
    cache.set(code, tree);
    return tree;
  }

  #asLine(raw) {
    return {
      itemCode: raw.ItemCode || null,
      itemName: raw.ItemName || null,
      lineType: raw.ItemType || null,
      quantityPer: num(raw.Quantity),
      warehouse: raw.Warehouse || null,
      price: num(raw.Price)
    };
  }

  #linesOf(parentCode, tree) {
    const per = num(tree.Quantity) || 1;
    return (tree.ProductTreeLines || []).map((raw, index) => {
      const line = this.#asLine(raw);
      // Store the quantity per one finished piece, not per the BOM's own batch
      // size, so the availability check can multiply by the card's quantity and
      // nothing else.
      return { parentCode, lineNo: index, ...line, quantityPer: line.quantityPer / per };
    });
  }

  /**
   * Is the sewing resource anywhere under this component?
   *
   * A bag is identified by the work that makes it, and that work can sit a
   * couple of levels down: in FG100790 the bag group holds four sub-assemblies
   * and only those carry PC100001. Checking one level below missed three
   * projects' bags entirely, which is why this recurses.
   */
  async #hasSewingBelow(code, trees, items, depth = 0) {
    if (depth >= SEWING_DEPTH) return false;
    const tree = await this.#tree(code, trees);
    if (!tree) return false;

    const lines = tree.ProductTreeLines || [];
    if (lines.some((line) => line.ItemCode === RES_SEWING)) return true;

    for (const line of lines) {
      if (!line.ItemCode || line.ItemType === 'pit_Resource') continue;
      const item = items.get(line.ItemCode);
      if (!item || item.ProcurementMethod !== 'bom_Make') continue;
      if (await this.#hasSewingBelow(line.ItemCode, trees, items, depth + 1)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------- classifying

  /**
   * Guess what every level-1 and level-2 component is.
   *
   * Only components of finished goods are classified: a rivet three levels down
   * is never shown to anyone, so naming it would just fill the table.
   *
   * Level 2 is not optional and was once missed here, with a cost worth
   * recording: the containers themselves mostly sit at level 2, inside the
   * project's `_01` group, so classifying only level 1 left 24 real pallets,
   * lids, sleeves and KLT boxes with no kind at all - among them a StackMaxx
   * pallet standing at zero stock, which is exactly the case the planner needs
   * to be told about. Level 1 alone answers "is there a construction group";
   * level 2 answers "is the box in it actually there".
   */
  async classifyAll({ finishedGoods, items, trees }) {
    const guesses = new Map();

    for (const order of finishedGoods) {
      const tree = trees.get(order.ItemNo);
      if (!tree) continue;

      for (const raw of tree.ProductTreeLines || []) {
        const item = await this.#guess(raw, order.ItemNo, { items, trees, guesses });

        // Descend only into assemblies we make ourselves - a purchased item has
        // no tree of its own, and this is the same test collect() used when it
        // decided which level-2 rows to mirror, so nothing is classified that
        // was not stored.
        if (!item || item.ProcurementMethod !== 'bom_Make') continue;

        const sub = trees.get(raw.ItemCode);
        if (!sub) continue;

        for (const child of sub.ProductTreeLines || []) {
          await this.#guess(child, order.ItemNo, { items, trees, guesses });
        }
      }
    }

    return guesses;
  }

  /**
   * Guess one BOM line, and hand back its item so the caller can decide whether
   * to walk into it.
   *
   * Returns null for a line that is not material at all - a resource or a
   * text-only row - and for one SAP does not know; neither is worth descending
   * into. An item that was already settled by an earlier project is still
   * returned, so a sub-assembly shared between projects does not stop the walk.
   */
  async #guess(raw, projectCode, { items, trees, guesses }) {
    const line = this.#asLine(raw);
    if (isSkippableLine(line)) return null;

    const item = items.get(line.itemCode);
    if (!item) return null;
    if (guesses.has(line.itemCode)) return item;

    const contents = await this.#contentsOf(line.itemCode, item, trees, items);
    const { kind, reason } = classifyComponent({
      item: {
        itemName: item.ItemName,
        groupCode: Number(item.ItemsGroupCode),
        procurement: item.ProcurementMethod,
        isInventory: item.InventoryItem === 'tYES'
      },
      line,
      projectCode,
      contents
    });

    // A null kind means the rules could not tell - left out so the planner
    // sees it as "needs a decision" rather than as a settled ignore.
    if (kind) guesses.set(line.itemCode, { kind, reason });
    return item;
  }

  /** What an assembly holds, in the terms the classifier asks about. */
  async #contentsOf(code, item, trees, items) {
    if (item.ProcurementMethod !== 'bom_Make') return null;
    const tree = trees.get(code) || await this.#tree(code, trees);
    if (!tree) return null;

    const lines = (tree.ProductTreeLines || []);
    const material = lines.filter((line) => !isSkippableLine(this.#asLine(line)));

    let hasContainer = false;
    let fastenerLines = 0;
    for (const line of material) {
      const child = items.get(line.ItemCode);
      if (!child) continue;
      const group = Number(child.ItemsGroupCode);
      if (group === CONTAINER_GROUP) hasContainer = true;
      if (group === 109) fastenerLines += 1;
    }

    return {
      hasContainer,
      hasSewing: await this.#hasSewingBelow(code, trees, items),
      hasCutting: lines.some((line) => line.ItemCode === RES_CUTTING),
      materialLines: material.length,
      fastenerLines
    };
  }

  // ------------------------------------------------------------------ writing

  /**
   * Replace the mirror with what we just read, in one transaction.
   *
   * Wholesale replacement rather than a diff: the mirror has no history to
   * preserve and a stale row that quietly survives a diff is a bug nobody would
   * notice for weeks.
   */
  async store({ groups, open, finishedGoods, items, bomLines }, guesses) {
    const client = await pool.connect();
    const fgCodes = new Set(finishedGoods.map((order) => order.ItemNo));

    try {
      await client.query('BEGIN');

      await client.query('DELETE FROM sap_item_stock');
      await client.query('DELETE FROM sap_items');
      await client.query('DELETE FROM sap_boms');
      await client.query('DELETE FROM sap_production_orders');

      for (const [code, item] of items) {
        if (!item) continue;
        const group = Number(item.ItemsGroupCode);
        await client.query(
          `INSERT INTO sap_items
             (item_code, item_name, group_code, group_name, procurement,
              is_inventory, uom, on_stock, ordered_from_vendors)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            code, item.ItemName || null, Number.isFinite(group) ? group : null,
            groups.get(group) || null, item.ProcurementMethod || null,
            item.InventoryItem === 'tYES', item.InventoryUOM || null,
            num(item.QuantityOnStock), num(item.QuantityOrderedFromVendors)
          ]
        );

        // Only warehouses with something in them: 27 rows per item, of which
        // one or two ever matter, is 25 rows of noise.
        for (const store of item.ItemWarehouseInfoCollection || []) {
          const inStock = num(store.InStock);
          const committed = num(store.Committed);
          const ordered = num(store.Ordered);
          if (!inStock && !committed && !ordered) continue;
          await client.query(
            `INSERT INTO sap_item_stock (item_code, warehouse, in_stock, committed, ordered)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (item_code, warehouse) DO UPDATE
                SET in_stock = EXCLUDED.in_stock,
                    committed = EXCLUDED.committed,
                    ordered = EXCLUDED.ordered,
                    synced_at = CURRENT_TIMESTAMP`,
            [code, store.WarehouseCode, inStock, committed, ordered]
          );
        }
      }

      for (const order of open) {
        await client.query(
          `INSERT INTO sap_production_orders
             (absolute_entry, item_code, description, project_type, planned_qty,
              completed_qty, status, warehouse, start_date, due_date, is_finished_good)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            Number(order.AbsoluteEntry), order.ItemNo,
            order.ProductDescription || null, projectTypeOf(order.ProductDescription),
            num(order.PlannedQuantity), num(order.CompletedQuantity),
            order.ProductionOrderStatus || null, order.Warehouse || null,
            day(order.StartDate), day(order.DueDate),
            fgCodes.has(order.ItemNo)
          ]
        );
      }

      for (const line of bomLines) {
        await client.query(
          `INSERT INTO sap_boms
             (parent_code, line_no, item_code, item_name, quantity_per,
              warehouse, line_type, price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (parent_code, line_no) DO UPDATE
              SET item_code = EXCLUDED.item_code,
                  item_name = EXCLUDED.item_name,
                  quantity_per = EXCLUDED.quantity_per,
                  warehouse = EXCLUDED.warehouse,
                  line_type = EXCLUDED.line_type,
                  price = EXCLUDED.price,
                  synced_at = CURRENT_TIMESTAMP`,
          [
            line.parentCode, line.lineNo, line.itemCode, line.itemName,
            line.quantityPer, line.warehouse, line.lineType, line.price
          ]
        );
      }

      // The guesses. A manual row is the planner's decision and outranks
      // anything this service works out, so the update is guarded on source.
      for (const [code, { kind, reason }] of guesses) {
        await client.query(
          `INSERT INTO sap_item_kinds (item_code, kind, source, reason)
           VALUES ($1,$2,'auto',$3)
           ON CONFLICT (item_code) DO UPDATE
              SET kind = EXCLUDED.kind,
                  reason = EXCLUDED.reason,
                  set_at = CURRENT_TIMESTAMP
            WHERE sap_item_kinds.source = 'auto'`,
          [code, kind, reason]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------- a pass

  async runOnce() {
    if (this.inFlight) {
      logger.debug('SAP sync already running, skipping this tick');
      return null;
    }

    const reason = this.client.unavailable;
    if (reason) {
      logger.debug('SAP sync skipped', { reason });
      return null;
    }

    this.inFlight = true;
    this.client.resetCallCount();
    const startedAt = new Date();
    const began = Date.now();

    try {
      const collected = await this.collect();
      const guesses = await this.classifyAll(collected);
      await this.store(collected, guesses);

      const summary = {
        orders: collected.open.length,
        finishedGoods: collected.finishedGoods.length,
        items: [...collected.items.values()].filter(Boolean).length,
        bomLines: collected.bomLines.length,
        classified: guesses.size,
        calls: this.client.callCount,
        ms: Date.now() - began
      };

      await this.#log(startedAt, summary, null);
      logger.info('SAP sync complete', summary);
      return summary;
    } catch (error) {
      await this.#log(startedAt, { calls: this.client.callCount, ms: Date.now() - began }, error);
      // A failed pass leaves the previous mirror in place. Stale data with a
      // timestamp beats no data, so this never throws upward.
      logger.error('SAP sync failed', { error: error.message });
      return null;
    } finally {
      this.inFlight = false;
      await this.client.logout();
    }
  }

  async #log(startedAt, summary, error) {
    try {
      await pool.query(
        `INSERT INTO sap_sync_log
           (started_at, finished_at, duration_ms, orders, items, bom_lines, http_calls, ok, error)
         VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4, $5, $6, $7, $8)`,
        [
          startedAt, summary.ms || null, summary.orders || 0, summary.items || 0,
          summary.bomLines || 0, summary.calls || 0, !error, error ? error.message : null
        ]
      );
    } catch (logError) {
      logger.error('Could not write the SAP sync log', { error: logError.message });
    }
  }

  start() {
    if (this.isRunning) return;

    const reason = this.client.unavailable;
    if (reason) {
      logger.info('SAP sync not started', { reason });
      return;
    }

    const minutes = Math.max(5, Math.min(SYNC_MINUTES, 60));
    this.cronJob = cron.schedule(`*/${minutes} * * * *`, () => this.runOnce());
    this.isRunning = true;

    logger.info('SAP sync started', {
      everyMinutes: minutes,
      host: process.env.SAP_HOST,
      db: process.env.SAP_DB,
      readOnly: true
    });

    // A first pass on boot, so a restart does not leave the mirror an interval
    // behind. Deliberately not awaited: SAP being slow must not delay startup.
    this.runOnce();
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    this.isRunning = false;
  }
}

module.exports = SapSyncService;
module.exports.KIND = KIND;
