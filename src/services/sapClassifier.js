/**
 * Deciding which BOM components the planner actually cares about.
 *
 * At planning time the question is narrow: are the CONSTRUCTIONS and the BAGS
 * there for the batch I am putting on this day. Rivets, printed labels, spray
 * glue, cut board and PVC tube are not asked about - they can be made or found
 * quickly, and listing them buries the two things that matter.
 *
 * SAP has no field that says "this is a box" or "this is a bag", so this module
 * infers it. Every rule below was checked against 24 real open orders across
 * all four project types; the reasoning is recorded next to each one because
 * the obvious-looking rules are the wrong ones.
 *
 * Nothing here does I/O. The caller resolves the BOM and hands over what it
 * found, which keeps the rules testable against fixtures and keeps the
 * traversal in one place - see sapSyncService.
 */

// Groups that never carry anything the planner wants to see at planning time.
//   104 Service, 106 Routing Control, 109 DIN Parts (rivets, washers, screws),
//   110 Food, 111 Hilfsmaterial (ink, spray glue, paint - used at 0.01/unit).
const IGNORED_GROUPS = new Set([104, 106, 109, 110, 111]);

// 107 GLT's_KLT's is the one group that reliably means "physical container":
// StackMaxx pallets and lids, Euro Containers, RL-KLT boxes, Eurobehälter.
// 12 of 12 "Twin lid" items and 18 of 20 "StackMaxx" items sit here.
const CONTAINER_GROUP = 107;

// Labels are printed to order and the boss explicitly does not want them.
const IGNORED_NAME = /label|etiket|sticker|orajet|printfoil|signiertint/i;

// The three work resources in the BOMs. They are not materials and have no
// stock, so they are never checked - but which one appears tells you what the
// assembly IS, which is the most reliable signal we found.
const RES_CUTTING = 'PC100000';   // COST textile cutting
const RES_SEWING = 'PC100001';    // COST sewing of textiles
const RES_ASSEMBLY = 'PC100002';  // COST assembly of textile + Quality control

// A construction bought from a partner (ASPF, PL) appears as an RM item in the
// project's _01 group and costs hundreds of euros. Across ten SLT projects the
// figures were 210, 420, 435, 440, 445, 445, 445, 540, 780 and 794 EUR, while
// fasteners, labels and consumables in the same BOMs ran 0.20 to 12 EUR. The
// gap is wide enough that a threshold in the middle cannot be tripped by
// accident.
const PARTNER_PRICE_EUR = Number(process.env.SAP_CONSTRUCTION_MIN_PRICE || 50);

const KIND = {
  CONSTRUCTION: 'konstrukcia',
  BAG: 'taska',
  IGNORE: 'ignoruj'
};

/**
 * Which platform a project is, read out of its product description.
 *
 * Descriptions look like `FG100808_00_GLT_6220085_Abdeckung...`, so the code is
 * delimited by underscores or spaces. A \b word boundary does NOT work here:
 * an underscore is a word character, so `_GLT_` has no boundary around it and
 * the match silently never fires.
 *
 * It matters because it changes what counts as a problem. A TXT project is
 * bags sewn into a container the customer already owns - it has no construction
 * by design, and warning about the missing one would be noise.
 */
function projectTypeOf(description) {
  const match = String(description || '').match(/(?:^|[_\s])(SLT|TXT|GLT|KLT)(?:[_\s]|$)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * The group number in a component named after its parent - `FG100808_02` is 2.
 *
 * These are the project's own assemblies; generic shared material carries its
 * own name instead. The numbering is not a schedule though: it varies between
 * `_01`, `_0001` and gaps (FG100728 starts at `_03`), so it is used as a hint
 * and never as a rule on its own.
 */
function groupNumberOf(itemName, projectCode) {
  if (!itemName || !projectCode) return null;
  const match = String(itemName).match(new RegExp(`^${projectCode}_0*(\\d+)$`, 'i'));
  return match ? Number(match[1]) : null;
}

/** True for BOM lines that are not material at all: resources and text rows. */
function isSkippableLine(line) {
  if (!line) return true;
  if (!line.itemCode) return true;                    // text-only row
  return line.lineType === 'pit_Resource';
}

/**
 * What one component is, given the item and what its own BOM contains.
 *
 * `contents` is null for a component with no BOM of its own, and otherwise:
 *   hasContainer  an item from group 107 anywhere below it
 *   hasSewing     the sewing resource anywhere below it
 *   hasCutting    the cutting resource
 *   materialLines how many material rows it has
 *   fastenerLines how many of those are group 109
 *
 * Sewing must be looked for at ANY depth, not one level down. In FG100790 the
 * bag group `_02` holds four sub-assemblies and the sewing sits inside those -
 * checking only the level below missed three projects' bags entirely.
 */
function classifyComponent({ item, line = {}, projectCode = null, contents = null }) {
  if (!item) return { kind: KIND.IGNORE, reason: 'unknown item' };

  const name = String(item.itemName || '');
  const group = Number(item.groupCode);
  const groupNumber = groupNumberOf(name, projectCode);
  const price = Number(line.price || 0);

  if (item.isInventory === false) {
    return { kind: KIND.IGNORE, reason: 'not an inventory item' };
  }
  if (IGNORED_GROUPS.has(group)) {
    return { kind: KIND.IGNORE, reason: `group ${group}` };
  }
  if (IGNORED_NAME.test(name)) {
    return { kind: KIND.IGNORE, reason: 'label or consumable by name' };
  }

  // The container itself, at any level. This is the strongest rule we have.
  if (group === CONTAINER_GROUP) {
    return { kind: KIND.CONSTRUCTION, reason: `group ${CONTAINER_GROUP}` };
  }

  // A construction the partner builds and we buy in: purchased, sits in the
  // project's first group, and costs real money.
  if (item.procurement === 'bom_Buy' && groupNumber === 1 && price >= PARTNER_PRICE_EUR) {
    return {
      kind: KIND.CONSTRUCTION,
      reason: `purchased _01 at ${price.toFixed(0)} EUR`
    };
  }

  if (contents) {
    if (contents.hasContainer) {
      return { kind: KIND.CONSTRUCTION, reason: `contains group ${CONTAINER_GROUP}` };
    }
    if (contents.hasSewing) {
      return { kind: KIND.BAG, reason: 'sewing below' };
    }
    // Only fasteners and no work at all: this is the mounting kit used when the
    // customer supplies the container, or the job is a repair. FG100790_01 and
    // FG100873_01 are both exactly this.
    if (contents.materialLines > 0 && contents.fastenerLines === contents.materialLines) {
      return { kind: KIND.IGNORE, reason: 'fasteners only' };
    }
    if (contents.hasCutting && !contents.hasSewing) {
      return { kind: KIND.IGNORE, reason: 'cut part' };
    }
  }

  // A purchased leaf named after the project but cheap - a detail part, not a
  // construction. Left unclassified so the planner can decide once.
  return {
    kind: null,
    reason: groupNumber
      ? `group _${String(groupNumber).padStart(2, '0')}, unclear`
      : 'unclear'
  };
}

/**
 * The four states a checked component can be in.
 *
 * The batch quantity drives this, not the order's remaining quantity: the plan
 * is filled in slices - 50 pieces in CW 39, another 100 in CW 45 - so an order
 * for 424 with 122 covered is perfectly fine for a batch of 50. Comparing
 * against the whole order would raise an alarm on almost every project.
 *
 * UNKNOWN is separate from SHORT on purpose. "There is no construction in the
 * BOM" is not a shortage, it is an absence of information, and the planner has
 * to go and look rather than order something. Colouring it red would let it
 * blend into the real shortages.
 */
const STATE = {
  OK: 'ok',
  COMING: 'coming',
  SHORT: 'short',
  UNKNOWN: 'unknown'
};

/**
 * Is this component covered for `needed` pieces?
 *
 * The question differs by how the component is obtained, and asking the wrong
 * one is what made two earlier versions of this check useless:
 *
 *   purchased for stock   is it on the shelf, or on order from a vendor
 *   made in-house         a made-to-order bag is SUPPOSED to have zero stock,
 *                         so the question is whether the work has been created
 *   bought from a partner same as purchased - the steel frames sit at zero and
 *                         are ordered against the project
 *
 * Deliberately not used: SAP's due dates, which drift badly here because the
 * plan changes daily and the seamstresses follow the plan rather than SAP; and
 * `Committed`, which is demand summed across every open order and so exceeds
 * stock on nearly every item in a healthy factory.
 */
function componentState({ needed, inStock = 0, orderedFromVendors = 0, openOrderQty = 0, procurement }) {
  const need = Number(needed) || 0;
  const stock = Number(inStock) || 0;

  if (need <= 0) return { state: STATE.OK, detail: 'nothing needed' };
  if (stock >= need) return { state: STATE.OK, detail: `${stock} in stock` };

  if (procurement === 'bom_Make') {
    const open = Number(openOrderQty) || 0;
    if (open > 0 && stock + open >= need) {
      return {
        state: STATE.COMING,
        detail: `${stock} in stock, ${open} on a production order`
      };
    }
    if (open > 0) {
      return {
        state: STATE.SHORT,
        detail: `${stock} in stock + ${open} being made = ${stock + open}, need ${need}`
      };
    }
    return { state: STATE.SHORT, detail: `${stock} in stock and nobody has started making it` };
  }

  const ordered = Number(orderedFromVendors) || 0;
  if (ordered > 0 && stock + ordered >= need) {
    return {
      state: STATE.COMING,
      detail: `${stock} in stock, ${ordered} on order from the supplier`
    };
  }
  if (ordered > 0) {
    return {
      state: STATE.SHORT,
      detail: `${stock} in stock + ${ordered} on order = ${stock + ordered}, need ${need}`
    };
  }
  return { state: STATE.SHORT, detail: `${stock} in stock and nothing on order` };
}

module.exports = {
  KIND,
  STATE,
  CONTAINER_GROUP,
  IGNORED_GROUPS,
  RES_CUTTING,
  RES_SEWING,
  RES_ASSEMBLY,
  PARTNER_PRICE_EUR,
  projectTypeOf,
  groupNumberOf,
  isSkippableLine,
  classifyComponent,
  componentState
};
