const pool = require('../database/config');
const { KIND, STATE, componentState } = require('./sapClassifier');

/**
 * What the planner sees about materials when a batch goes on a day.
 *
 * Answers one question - are the constructions and the bags there for THIS
 * batch - and answers it from the local mirror, never from SAP. The mirror is
 * refreshed every 15 minutes in the background, so this is fast, cannot fail
 * because a VPN tunnel dropped, and returns the same shape whether SAP is up or
 * not. The answer carries the age of the data so the screen can say it.
 *
 * The result is INFORMATION, never a verdict. Nothing here can stop a card
 * being saved: the boss plans what he decides to plan, and a red light is there
 * to tell him what to chase, not to argue with him.
 */

// Two levels, the same two the mirror stores. Level 1 is the project's own
// groups (_01, _02...), level 2 is what those groups are made of - which is
// where the bought containers actually sit.
const MAX_LEVEL = 2;

/**
 * Every component of a finished good, with what we know about it.
 *
 * quantity_per is multiplied down the levels, so `per_piece` is always per one
 * finished piece regardless of how deep the row sits. An item appearing in two
 * places is returned twice; the caller merges them.
 */
const COMPONENT_SQL = `
  WITH RECURSIVE walk AS (
      -- Cast: the multiplication below widens to plain numeric, and a recursive
      -- CTE requires both terms to agree on the type exactly.
      SELECT b.parent_code, b.item_code, b.item_name, b.quantity_per::numeric AS per_piece,
             b.price, 1 AS lvl
        FROM sap_boms b
       WHERE b.parent_code = $1
         AND b.item_code IS NOT NULL
         AND b.line_type = 'pit_Item'
      UNION ALL
      SELECT b.parent_code, b.item_code, b.item_name, w.per_piece * b.quantity_per,
             b.price, w.lvl + 1
        FROM walk w
        JOIN sap_boms b ON b.parent_code = w.item_code
       WHERE w.lvl < ${MAX_LEVEL}
         AND b.item_code IS NOT NULL
         AND b.line_type = 'pit_Item'
  )
  SELECT w.parent_code, w.item_code, w.per_piece, w.price, w.lvl,
         COALESCE(i.item_name, w.item_name) AS item_name,
         i.group_code, i.group_name, i.procurement, i.uom,
         i.on_stock, i.ordered_from_vendors,
         k.kind, k.source, k.reason,
         COALESCE(o.open_qty, 0) AS open_order_qty
    FROM walk w
    LEFT JOIN sap_items i      ON i.item_code = w.item_code
    LEFT JOIN sap_item_kinds k ON k.item_code = w.item_code
    LEFT JOIN (
        SELECT item_code, SUM(GREATEST(planned_qty - completed_qty, 0)) AS open_qty
          FROM sap_production_orders
         WHERE NOT is_finished_good
         GROUP BY item_code
    ) o ON o.item_code = w.item_code
   ORDER BY w.lvl, w.item_code`;

/** The open finished-good orders, which is what the planner picks from. */
async function projects() {
  const { rows } = await pool.query(
    `SELECT o.absolute_entry, o.item_code, o.description, o.project_type,
            o.planned_qty, o.completed_qty, o.status, o.start_date, o.due_date,
            i.item_name
       FROM sap_production_orders o
       LEFT JOIN sap_items i ON i.item_code = o.item_code
      WHERE o.is_finished_good
      ORDER BY o.item_code, o.absolute_entry`
  );

  return rows.map((row) => ({
    absoluteEntry: row.absolute_entry,
    itemCode: row.item_code,
    itemName: row.item_name,
    description: row.description,
    projectType: row.project_type,
    plannedQty: Number(row.planned_qty),
    completedQty: Number(row.completed_qty),
    // What is still to be made on this order. The batch being planned is a
    // slice of this, not the whole of it.
    remainingQty: Math.max(Number(row.planned_qty) - Number(row.completed_qty), 0),
    status: row.status,
    startDate: row.start_date,
    dueDate: row.due_date
  }));
}

/** When the mirror was last filled, so the screen can say how old it is. */
async function lastSyncedAt() {
  const { rows } = await pool.query(
    `SELECT finished_at FROM sap_sync_log
      WHERE ok ORDER BY id DESC LIMIT 1`
  );
  return rows.length ? rows[0].finished_at : null;
}

/** One order, or null. */
async function order(absoluteEntry) {
  const { rows } = await pool.query(
    `SELECT o.absolute_entry, o.item_code, o.description, o.project_type,
            o.planned_qty, o.completed_qty, o.status, o.start_date, o.due_date,
            i.item_name
       FROM sap_production_orders o
       LEFT JOIN sap_items i ON i.item_code = o.item_code
      WHERE o.absolute_entry = $1`,
    [absoluteEntry]
  );
  if (!rows.length) return null;

  const row = rows[0];
  return {
    absoluteEntry: row.absolute_entry,
    itemCode: row.item_code,
    itemName: row.item_name,
    description: row.description,
    projectType: row.project_type,
    plannedQty: Number(row.planned_qty),
    completedQty: Number(row.completed_qty),
    remainingQty: Math.max(Number(row.planned_qty) - Number(row.completed_qty), 0),
    status: row.status,
    startDate: row.start_date,
    dueDate: row.due_date
  };
}

/**
 * Merge the rows of one item into a single component.
 *
 * A container used by two groups of the same project needs both lots, so the
 * per-piece quantities add up; the parents are kept so the screen can say where
 * it sits. The shallowest level wins, because that is where the planner reads
 * it in SAP.
 */
function merge(rows) {
  const byItem = new Map();

  for (const row of rows) {
    const existing = byItem.get(row.item_code);
    if (existing) {
      existing.perPiece += Number(row.per_piece);
      if (!existing.parents.includes(row.parent_code)) existing.parents.push(row.parent_code);
      existing.level = Math.min(existing.level, row.lvl);
      continue;
    }

    byItem.set(row.item_code, {
      itemCode: row.item_code,
      itemName: row.item_name,
      groupCode: row.group_code,
      groupName: row.group_name,
      procurement: row.procurement,
      uom: row.uom,
      level: row.lvl,
      parents: [row.parent_code],
      perPiece: Number(row.per_piece),
      price: row.price === null ? null : Number(row.price),
      inStock: Number(row.on_stock || 0),
      orderedFromVendors: Number(row.ordered_from_vendors || 0),
      openOrderQty: Number(row.open_order_qty || 0),
      kind: row.kind,
      // 'manual' means a person decided this, and the screen says so - a guess
      // and a decision must not look the same.
      kindSource: row.source,
      kindReason: row.reason,
      // Null until the item master is known. An item in a BOM that SAP has no
      // master record for is possible and must not read as "zero in stock".
      known: row.procurement !== null
    });
  }

  return [...byItem.values()];
}

/** The worst state present, in the order the planner cares about. */
function worstOf(states) {
  if (states.includes(STATE.SHORT)) return STATE.SHORT;
  if (states.includes(STATE.COMING)) return STATE.COMING;
  if (states.includes(STATE.OK)) return STATE.OK;
  return STATE.UNKNOWN;
}

/**
 * The material picture for one batch of one order.
 *
 * `batchQty` is what is going on the day, not what the order is for. That
 * distinction is the whole point: an order for 424 pieces with 122 covered is
 * perfectly fine for a batch of 50, and checking against the order total would
 * light up nearly every project in the factory.
 */
async function forOrder(absoluteEntry, batchQty) {
  const found = await order(absoluteEntry);
  if (!found) return null;

  const qty = Math.max(Number(batchQty) || 0, 0);
  const { rows } = await pool.query(COMPONENT_SQL, [found.itemCode]);
  const components = merge(rows);

  const check = (component) => {
    const needed = Math.ceil(component.perPiece * qty);
    if (!component.known) {
      return {
        ...component,
        needed,
        state: STATE.UNKNOWN,
        detail: 'SAP has no item master for this code'
      };
    }
    const { state, detail } = componentState({
      needed,
      inStock: component.inStock,
      orderedFromVendors: component.orderedFromVendors,
      openOrderQty: component.openOrderQty,
      procurement: component.procurement
    });
    return { ...component, needed, state, detail };
  };

  const constructions = components.filter((c) => c.kind === KIND.CONSTRUCTION).map(check);
  const bags = components.filter((c) => c.kind === KIND.BAG).map(check);

  // Everything we deliberately did not check, with the reason. This is what
  // turns "no construction found" from a dead end into something the planner
  // can act on: for a project whose frame is cut from profiles rather than
  // bought as a piece, the profiles are right here in this list.
  const other = components
    .filter((c) => c.kind !== KIND.CONSTRUCTION && c.kind !== KIND.BAG)
    .map((component) => ({
      itemCode: component.itemCode,
      itemName: component.itemName,
      groupCode: component.groupCode,
      groupName: component.groupName,
      level: component.level,
      parents: component.parents,
      price: component.price,
      procurement: component.procurement,
      inStock: component.inStock,
      kind: component.kind,
      kindReason: component.kindReason
    }));

  return {
    order: found,
    batchQty: qty,
    syncedAt: await lastSyncedAt(),
    // Sorted so the level-1 group comes before the box inside it and the screen
    // can nest them without sorting again.
    constructions: constructions.sort((a, b) => a.level - b.level || a.itemCode.localeCompare(b.itemCode)),
    bags: bags.sort((a, b) => a.level - b.level || a.itemCode.localeCompare(b.itemCode)),
    other: other.sort((a, b) => a.level - b.level || a.itemCode.localeCompare(b.itemCode)),
    constructionState: constructions.length ? worstOf(constructions.map((c) => c.state)) : STATE.UNKNOWN,
    bagState: bags.length ? worstOf(bags.map((c) => c.state)) : STATE.UNKNOWN,
    // A TXT project has no construction by design, so its absence is not news.
    // Everything else with nothing found is worth a look by a human.
    noConstructionInSap: constructions.length === 0,
    noBagsInSap: bags.length === 0,
    componentsFound: components.length
  };
}

/**
 * Record what a component really is.
 *
 * Stored against the item and not the project, because a StackMaxx lid is a
 * construction in every project it appears in - decided once, holds forever.
 * source='manual' is what protects it: the sync only ever overwrites its own
 * guesses.
 */
async function setKind(itemCode, kind, user) {
  const allowed = [KIND.CONSTRUCTION, KIND.BAG, KIND.IGNORE];
  if (!allowed.includes(kind)) return { badKind: true };

  const { rows } = await pool.query(
    `INSERT INTO sap_item_kinds (item_code, kind, source, reason, set_by, set_by_name)
     VALUES ($1, $2, 'manual', $3, $4, $5)
     ON CONFLICT (item_code) DO UPDATE
        SET kind = EXCLUDED.kind,
            source = 'manual',
            reason = EXCLUDED.reason,
            set_by = EXCLUDED.set_by,
            set_by_name = EXCLUDED.set_by_name,
            set_at = CURRENT_TIMESTAMP
     RETURNING item_code, kind, source, reason, set_by_name, set_at`,
    [itemCode, kind, `označené ručne (${user.name || user.id})`, user.id, user.name || null]
  );

  return { kind: rows[0] };
}

module.exports = {
  projects,
  order,
  forOrder,
  setKind,
  lastSyncedAt
};
