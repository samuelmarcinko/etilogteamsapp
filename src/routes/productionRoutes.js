const express = require('express');
const router = express.Router();
const ProductionPlan = require('../database/models/ProductionPlan');
const ProductionEntry = require('../database/models/ProductionEntry');
const { verifyToken } = require('../middleware/auth');
const { attachDbRole, requirePermission } = require('../middleware/portalAuth');
const { asyncHandler } = require('../middleware/errorHandler');
const ProductionRevision = require('../database/models/ProductionRevision');
const ProductionRetentionService = require('../services/productionRetentionService');
const PlanChangeSummary = require('../services/planChangeSummary');
const PlanNotificationService = require('../services/planNotificationService');

/**
 * Production Plan API.
 *
 * Reads for the planner grid and viewer, plus the writes drag & drop needs:
 * create, edit, delete, move with conflict resolution, undo, the Unscheduled
 * queue and day flags. Draft/publish and revisions arrive in their own step.
 *
 * Gating: production.view to read, production.manage to change anything. Today
 * only admin holds either, which is why legacyRoles is ['admin'] - it keeps the
 * shadow comparison meaningful for these routes too.
 */
const viewAccess = [verifyToken, attachDbRole,
  requirePermission('production.view', { legacyRoles: ['admin'] })];

const manageAccess = [verifyToken, attachDbRole,
  requirePermission('production.manage', { legacyRoles: ['admin'] })];

const currentUser = (req) => ({ id: req.user.id, name: req.user.name || req.user.email });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Two priorities only: "this one is urgent" is the single thing a colour must
// never be free to say. Everything else is grouped with a colour of the
// planner's choosing instead - see migration 028.
const PRIORITIES = ['normal', 'urgent'];
const COLORS = ['sky', 'cyan', 'teal', 'emerald', 'lime', 'amber', 'orange', 'pink', 'violet', 'slate'];
// Two statuses, for the same reason: a card is still to be made, or it is
// finished. See migration 029.
const STATUSES = ['planned', 'done'];
const DAY_FLAGS = ['free', 'important', 'urgent'];

/**
 * Validate and normalise a card payload.
 *
 * Returns { error } or { value }.
 */
function parseEntryPayload(body, { requireLocation }) {
  const value = {};

  if (requireLocation) {
    const locationId = Number(body.locationId);
    if (!Number.isInteger(locationId) || locationId <= 0) return { error: 'locationId is required' };
    value.locationId = locationId;
  }

  const hasProduct = body.productId != null && body.productId !== '';
  const hasCustom = typeof body.customProductName === 'string' && body.customProductName.trim();
  if (hasProduct === Boolean(hasCustom)) {
    return { error: 'Provide either productId or customProductName, not both' };
  }
  value.productId = hasProduct ? Number(body.productId) : null;
  value.customProductName = hasCustom ? body.customProductName.trim() : null;
  if (hasProduct && !Number.isInteger(value.productId)) return { error: 'productId must be an integer' };

  if (body.productionDate != null && body.productionDate !== '') {
    if (!ISO_DATE.test(body.productionDate)) return { error: 'productionDate must be YYYY-MM-DD' };
    value.productionDate = body.productionDate;
    value.shiftId = body.shiftId != null && body.shiftId !== '' ? Number(body.shiftId) : null;
    if (value.shiftId != null && !Number.isInteger(value.shiftId)) {
      return { error: 'shiftId must be an integer' };
    }
  } else {
    // No date means the Unscheduled queue, which has no shift either.
    value.productionDate = null;
    value.shiftId = null;
  }

  if (body.dueDate != null && body.dueDate !== '') {
    if (!ISO_DATE.test(body.dueDate)) return { error: 'dueDate must be YYYY-MM-DD' };
    value.dueDate = body.dueDate;
  } else {
    value.dueDate = null;
  }

  const quantity = parseQuantity(body.quantity);
  if (quantity.error) return { error: quantity.error };
  Object.assign(value, quantity.value);

  value.priority = body.priority || 'normal';
  if (!PRIORITIES.includes(value.priority)) {
    return { error: `priority must be one of ${PRIORITIES.join(', ')}` };
  }

  // A colour belongs to ordinary work; urgent has its own and would drown it.
  value.color = COLORS.includes(body.color) ? body.color : null;
  if (value.priority === 'urgent') value.color = null;

  value.status = body.status || 'planned';
  if (!STATUSES.includes(value.status)) {
    return { error: `status must be one of ${STATUSES.join(', ')}` };
  }

  value.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

  // Which SAP production order this card is a slice of, when it came from one.
  // Optional on purpose: planning ahead of SAP, or for work SAP knows nothing
  // about, has to keep working exactly as it does today - such a card simply
  // gets no material check.
  if (body.sapOrderEntry == null || body.sapOrderEntry === '') {
    value.sapOrderEntry = null;
  } else {
    const sapOrderEntry = Number(body.sapOrderEntry);
    if (!Number.isInteger(sapOrderEntry) || sapOrderEntry <= 0) {
      return { error: 'sapOrderEntry must be a SAP order number' };
    }
    value.sapOrderEntry = sapOrderEntry;
  }

  return { value };
}

/**
 * Quantity: a whole number of pieces, or nothing at all.
 *
 * The Excel sheets used to carry "130+22" - two deliveries typed into one cell
 * because a cell was all there was. Two deliveries are two cards here, so the
 * composite forms are gone (migration 029) and anything that is not a count is
 * rejected rather than stored as text nobody can add up.
 */
function parseQuantity(input) {
  if (input == null || input === '') {
    return { value: { plannedQuantity: null } };
  }

  const raw = typeof input === 'number' ? input : String(input).trim();
  if (raw === '') return { value: { plannedQuantity: null } };

  const quantity = Number(raw);
  if (!Number.isInteger(quantity) || quantity < 0) {
    return { error: 'quantity must be a whole number of pieces' };
  }
  return { value: { plannedQuantity: quantity } };
}

/**
 * Validate a from/to pair. Returns an error string, or null when valid.
 * Capped at roughly a year so a stray query cannot pull the whole history.
 */
function validateRange(from, to) {
  if (!ISO_DATE.test(from || '') || !ISO_DATE.test(to || '')) {
    return 'from and to are required, formatted YYYY-MM-DD';
  }
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'from and to must be valid dates';
  }
  if (end < start) return 'to must not be earlier than from';
  const days = (end - start) / 86400000;
  if (days > 400) return 'range must not exceed 400 days';
  return null;
}

// =========================================================
// Locations
// =========================================================
// GET /api/production/locations?includeInactive=true
router.get('/locations', viewAccess, asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  const locations = await ProductionPlan.findLocations({ includeInactive });
  res.json({ data: locations });
}));

// GET /api/production/locations/:code/shifts
router.get('/locations/:code/shifts', viewAccess, asyncHandler(async (req, res) => {
  const location = await ProductionPlan.findLocationByCode(req.params.code);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const shifts = await ProductionPlan.findShifts(location.id);
  res.json({ data: shifts });
}));

// =========================================================
// The plan itself
// =========================================================
// GET /api/production/plan?location=PO1&from=2026-08-17&to=2026-09-13
//
// One request returns everything the grid needs for the visible range: the
// location, its shifts, the entries, day flags and calendar exceptions. The
// grid renders whole weeks at a time, so splitting this into four calls would
// only add round trips and partial-render flicker.
router.get('/plan', viewAccess, asyncHandler(async (req, res) => {
  const { location: code, from, to } = req.query;

  if (!code) return res.status(400).json({ error: 'Bad Request', message: 'location is required' });

  const rangeError = validateRange(from, to);
  if (rangeError) return res.status(400).json({ error: 'Bad Request', message: rangeError });

  const location = await ProductionPlan.findLocationByCode(code);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const [shifts, exceptions] = await Promise.all([
    ProductionPlan.findShifts(location.id),
    ProductionPlan.findCalendarExceptions(location.id, from, to)
  ]);

  // ?published=1 is what the shop floor asks for: the last published revision
  // of each week rather than the live rows a planner is still moving around.
  // Same response shape either way, so the viewer renders one thing.
  //
  // A week with no revision comes back empty and is listed in `revisions` as
  // unpublished, rather than quietly falling back to the live rows - a fallback
  // would put the floor back to watching the planner think, which is the whole
  // reason revisions exist.
  if (req.query.published === '1') {
    const weeks = ProductionRevision.weeksBetween(from, to);
    const [current, previous] = await Promise.all([
      ProductionRevision.findCurrent(location.id, weeks),
      ProductionRevision.findPrevious(location.id, weeks)
    ]);

    const entries = [];
    const dayFlags = [];
    const shiftNotes = [];
    const revisions = [];
    // What the last publish brought, per card. The floor is told the plan
    // changed; this is what lets the screen show WHERE, instead of leaving
    // everyone to spot it. A first revision has nothing to compare against, so
    // its cards are not marked new - a week published for the first time is all
    // new, and flagging every card would say nothing.
    const changes = { added: [], changed: [], removed: [] };

    for (const weekStart of weeks) {
      const published = current[weekStart];
      revisions.push({
        weekStart,
        revision: published?.revision || null,
        publishedAt: published?.published_at || null,
        publishedByName: published?.published_by_name || null
      });

      const snapshot = published?.snapshot;
      if (!snapshot) continue;
      entries.push(...(snapshot.entries || []));
      dayFlags.push(...(snapshot.dayFlags || []));
      shiftNotes.push(...(snapshot.shiftNotes || []));

      const before = previous[weekStart];
      if (!before?.snapshot) continue;
      const diff = ProductionRevision.diffEntries(before.snapshot, snapshot);
      changes.added.push(...diff.added);
      changes.changed.push(...diff.changed);
      changes.removed.push(...diff.removed.map((row) => ({ ...row, weekStart })));
    }

    return res.json({
      data: {
        location,
        range: { from, to },
        published: true,
        shifts,
        entries,
        dayFlags,
        shiftNotes,
        calendarExceptions: exceptions,
        revisions,
        changes
      }
    });
  }

  const [entries, dayFlags, shiftNotes] = await Promise.all([
    ProductionPlan.findEntries(location.id, from, to),
    ProductionPlan.findDayFlags(location.id, from, to),
    ProductionPlan.findShiftNotes(location.id, from, to)
  ]);

  res.json({
    data: {
      location,
      range: { from, to },
      published: false,
      shifts,
      entries,
      dayFlags,
      shiftNotes,
      calendarExceptions: exceptions
    }
  });
}));

// =========================================================
// Publishing (section 5)
// =========================================================
// GET /api/production/pending?location=PO1&from=&to=
//
// Which weeks differ from what the floor was last told, and by how much. Read
// access on purpose: knowing the plan has unpublished work in it is part of
// reading the plan.
router.get('/pending', viewAccess, asyncHandler(async (req, res) => {
  const { location: code, from, to } = req.query;
  if (!code) return res.status(400).json({ error: 'Bad Request', message: 'location is required' });

  const rangeError = validateRange(from, to);
  if (rangeError) return res.status(400).json({ error: 'Bad Request', message: rangeError });

  const location = await ProductionPlan.findLocationByCode(code);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const pending = await ProductionRevision.findPending(location.id, from, to);
  res.json({
    data: {
      weeks: pending,
      changes: pending.reduce((total, week) => total + week.changes, 0)
    }
  });
}));

// POST /api/production/publish  { location, weeks: ['2026-08-24', ...] }
//
// One transaction for the whole set: a publish is one event, so the floor gets
// all of it or none of it. Weeks that have not changed are skipped rather than
// given a revision identical to the one before it.
router.post('/publish', manageAccess, asyncHandler(async (req, res) => {
  const location = await ProductionPlan.findLocationByCode(req.body.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const weeks = Array.isArray(req.body.weeks) ? req.body.weeks : [];
  if (!weeks.length) {
    return res.status(400).json({ error: 'Bad Request', message: 'weeks is required' });
  }
  if (weeks.length > 60) {
    return res.status(400).json({ error: 'Bad Request', message: 'too many weeks in one publish' });
  }
  for (const week of weeks) {
    if (!ISO_DATE.test(week) || ProductionRevision.weekStartOf(week) !== week) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `weeks must be Mondays formatted YYYY-MM-DD (got ${week})`
      });
    }
  }

  const published = await ProductionRevision.publish(location.id, weeks, currentUser(req));

  // After the commit, and never in front of it. The plan is published the
  // moment the transaction lands; telling people is a separate job that must
  // not be able to fail it. Not awaited, so a slow Teams API does not hold the
  // planner's browser - the service logs its own outcome and never throws.
  if (published.length) {
    PlanNotificationService.notifyPublished({
      location,
      weeks: published.map((week) => ({
        weekStart: week.weekStart,
        before: week.before,
        after: week.after
      })),
      publishedByName: currentUser(req).name
    });
  }

  res.json({
    data: {
      // Without the snapshots: they exist for the notification above, and a
      // publish of several weeks would otherwise send the whole plan twice
      // back to the browser that just sent it.
      published: published.map(({ before, after, ...week }) => week),
      changes: published.reduce((total, week) => total + week.change_count, 0)
    }
  });
}));

/**
 * GET /api/production/changes?location=PO1&from=&to=
 *
 * What the last publish of each week actually did, in sentences. The same
 * structure the viewer renders and the same one a Teams message or an email
 * will carry, so those can never disagree about what happened.
 */
router.get('/changes', viewAccess, asyncHandler(async (req, res) => {
  const rangeError = validateRange(req.query.from, req.query.to);
  if (rangeError) return res.status(400).json({ error: 'Bad Request', message: rangeError });

  const location = await ProductionPlan.findLocationByCode(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const weeks = ProductionRevision.weeksBetween(req.query.from, req.query.to);
  const [current, previous] = await Promise.all([
    ProductionRevision.findCurrent(location.id, weeks),
    ProductionRevision.findPrevious(location.id, weeks)
  ]);

  // A week published for the very first time is left out: every card in it
  // would read as new, which is true and says nothing.
  const pairs = weeks
    .filter((weekStart) => current[weekStart]?.snapshot && previous[weekStart]?.snapshot)
    .map((weekStart) => ({
      weekStart,
      before: previous[weekStart].snapshot,
      after: current[weekStart].snapshot
    }));

  const summary = PlanChangeSummary.summarise(pairs);
  const publishedAt = weeks
    .map((weekStart) => current[weekStart]?.published_at)
    .filter(Boolean)
    .sort()
    .pop() || null;

  res.json({
    data: {
      ...summary,
      publishedAt,
      text: PlanChangeSummary.asText(summary, {
        title: `Production plan updated — ${location.code}`
      })
    }
  });
}));

// GET /api/production/revisions?location=PO1 - what was published, and when
router.get('/revisions', viewAccess, asyncHandler(async (req, res) => {
  const location = await ProductionPlan.findLocationByCode(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const revisions = await ProductionRevision.findHistory(location.id, req.query.limit);
  res.json({ data: revisions });
}));

// GET /api/production/entries/:id - card detail
router.get('/entries/:id', viewAccess, asyncHandler(async (req, res) => {
  const entry = await ProductionPlan.findEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  res.json({ data: entry });
}));

// =========================================================
// Products (FG autocomplete)
// =========================================================
// GET /api/production/products?q=FG1008
router.get('/products', viewAccess, asyncHandler(async (req, res) => {
  const query = (req.query.q || '').trim();
  const products = await ProductionPlan.searchProducts(query);
  res.json({ data: products });
}));

// POST /api/production/products - register an FG typed by hand
router.post('/products', manageAccess, asyncHandler(async (req, res) => {
  const fgNumber = (req.body.fgNumber || '').trim();
  if (!/^FG\d+/i.test(fgNumber)) {
    return res.status(400).json({ error: 'Bad Request', message: 'fgNumber must start with FG followed by digits' });
  }
  const product = await ProductionEntry.findOrCreateProduct(fgNumber.toUpperCase(), req.body.description);
  res.status(201).json({ data: product });
}));

// PATCH /api/production/products/:id  { description }
//
// The description belongs to the FG, not to one card, so editing it here shows
// up on every card carrying that number - which is the point: the master list
// arrived from Excel with descriptions nobody could correct.
router.patch('/products/:id', manageAccess, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'id must be an integer' });
  }
  if (typeof req.body.description !== 'string' && req.body.description !== null) {
    return res.status(400).json({ error: 'Bad Request', message: 'description must be text' });
  }

  const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const product = await ProductionEntry.setProductDescription(id, description || null);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json({ data: product });
}));

// =========================================================
// Unscheduled queue
// =========================================================
// GET /api/production/unscheduled?location=PO1
router.get('/unscheduled', viewAccess, asyncHandler(async (req, res) => {
  const location = await ProductionPlan.findLocationByCode(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const entries = await ProductionEntry.findUnscheduled(location.id);
  res.json({ data: entries });
}));

// =========================================================
// Writes
// =========================================================
// POST /api/production/entries
router.post('/entries', manageAccess, asyncHandler(async (req, res) => {
  const parsed = parseEntryPayload(req.body, { requireLocation: true });
  if (parsed.error) return res.status(400).json({ error: 'Bad Request', message: parsed.error });

  const result = await ProductionEntry.create(parsed.value, currentUser(req));
  res.status(201).json({ data: result.entry, undo: result.undo });
}));

// PATCH /api/production/entries/:id
// expectedVersion guards against two planners overwriting each other; a
// mismatch is reported as 409 with the current row so the UI can show it.
router.patch('/entries/:id', manageAccess, asyncHandler(async (req, res) => {
  const parsed = parseEntryPayload(req.body, { requireLocation: false });
  if (parsed.error) return res.status(400).json({ error: 'Bad Request', message: parsed.error });

  const expectedVersion = req.body.version != null ? Number(req.body.version) : null;
  const result = await ProductionEntry.update(req.params.id, parsed.value, expectedVersion, currentUser(req));

  if (result.notFound) return res.status(404).json({ error: 'Entry not found' });
  if (result.conflict) {
    return res.status(409).json({
      error: 'Conflict',
      message: 'This card was changed by someone else. Reload before saving again.',
      data: result.current
    });
  }
  res.json({ data: result.entry });
}));

// POST /api/production/entries/:id/marks  { status?, priority?, color? }
//
// The three one-click marks on a card: closing a finished job, flagging one
// urgent, colouring a family of related work. Each used to mean opening the edit
// dialog and reading a form nobody wanted to read. Only the keys present are
// changed. No version check here on purpose: "this is finished" does not
// conflict with someone else's edit to the quantity, and refusing it would only
// mean a reload and a second click to say the same true thing.
router.post('/entries/:id/marks', manageAccess, asyncHandler(async (req, res) => {
  const marks = {};

  if (req.body.status !== undefined) {
    if (!STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: 'Bad Request', message: `status must be one of ${STATUSES.join(', ')}` });
    }
    marks.status = req.body.status;
  }

  if (req.body.priority !== undefined) {
    if (!PRIORITIES.includes(req.body.priority)) {
      return res.status(400).json({ error: 'Bad Request', message: `priority must be one of ${PRIORITIES.join(', ')}` });
    }
    marks.priority = req.body.priority;
  }

  if (req.body.color !== undefined) {
    if (req.body.color !== null && !COLORS.includes(req.body.color)) {
      return res.status(400).json({ error: 'Bad Request', message: `color must be null or one of ${COLORS.join(', ')}` });
    }
    marks.color = req.body.color;
  }

  if (!Object.keys(marks).length) {
    return res.status(400).json({ error: 'Bad Request', message: 'Provide at least one of status, priority, color' });
  }

  const result = await ProductionEntry.setMarks(req.params.id, marks, currentUser(req));
  if (result.notFound) return res.status(404).json({ error: 'Entry not found' });

  // Done goes live at once. It reports what the floor already did, so making it
  // queue behind a publish would leave finished work looking outstanding to the
  // people who finished it - and would mail everyone about a plan that has not
  // changed. Written straight into the revision the floor is reading; priority
  // and colour still wait for a publish, because those change what to do next.
  if (marks.status !== undefined && result.entry?.status === marks.status) {
    try {
      await ProductionRevision.patchEntryStatus(result.entry.location_id, result.entry, marks.status);
    } catch (error) {
      // The card is saved either way. Worst case the floor sees the new status
      // at the next publish, which is where it stood before this existed.
      console.error('Could not publish the status straight away:', error.message);
    }
  }

  // No undo snapshot: the control that set this also unsets it, one click away.
  res.json({ data: result.entry });
}));

// DELETE /api/production/entries/:id - soft delete
router.delete('/entries/:id', manageAccess, asyncHandler(async (req, res) => {
  const result = await ProductionEntry.softDelete(req.params.id, currentUser(req));
  if (result.notFound) return res.status(404).json({ error: 'Entry not found' });
  res.json({ undo: result.undo });
}));

// POST /api/production/entries/:id/move
//
// Body: { productionDate, shiftId, mode? }. A null productionDate means the
// Unscheduled queue. When the target already holds cards and no mode is given,
// this answers 409 with the occupants so the UI can ask which resolution the
// planner wants - it never guesses.
router.post('/entries/:id/move', manageAccess, asyncHandler(async (req, res) => {
  const { productionDate, shiftId, mode } = req.body;

  if (productionDate != null && productionDate !== '' && !ISO_DATE.test(productionDate)) {
    return res.status(400).json({ error: 'Bad Request', message: 'productionDate must be YYYY-MM-DD' });
  }
  if (mode && !ProductionEntry.MOVE_MODES.includes(mode)) {
    return res.status(400).json({
      error: 'Bad Request',
      message: `mode must be one of ${ProductionEntry.MOVE_MODES.join(', ')}`
    });
  }

  const result = await ProductionEntry.move(
    req.params.id,
    { productionDate: productionDate || null, shiftId: shiftId || null },
    mode || null,
    currentUser(req)
  );

  if (result.notFound) return res.status(404).json({ error: 'Entry not found' });
  if (result.needsDecision) {
    return res.status(409).json({
      error: 'Slot occupied',
      message: 'The target slot already contains production',
      occupants: result.occupants
    });
  }
  res.json({ data: result.entry, undo: result.undo });
}));

// POST /api/production/entries/undo - replay a snapshot returned by a write
router.post('/entries/undo', manageAccess, asyncHandler(async (req, res) => {
  const { positions, deleteIds } = req.body;

  const hasPositions = Array.isArray(positions) && positions.length > 0;
  const hasDeletes = Array.isArray(deleteIds) && deleteIds.length > 0;

  if (!hasPositions && !hasDeletes) {
    return res.status(400).json({ error: 'Bad Request', message: 'positions or deleteIds is required' });
  }

  // Both, when the operation did both - splitting a card reduces the original
  // and creates a second one, so undoing it means restoring one and removing
  // the other.
  const removed = hasDeletes
    ? await ProductionEntry.hardDelete(deleteIds.map(Number), currentUser(req))
    : { removed: [] };
  const restored = hasPositions
    ? await ProductionEntry.restorePositions(positions, currentUser(req))
    : { restored: [] };

  res.json({ data: { restored: restored.restored, removed: removed.removed } });
}));

// =========================================================
// Bulk operations (section 4.5)
// =========================================================
// A plan is rarely rearranged one card at a time - when a day falls out, the
// rest of the week slides. Each of these is one transaction and returns the
// same undo snapshot a single move does.

const DAY_MODES = ['merge', 'replace'];

/** Shared prologue: resolve the location and validate the dates. */
async function bulkContext(req, res, dateFields) {
  const location = await ProductionPlan.findLocationByCode(req.body.location);
  if (!location) {
    res.status(404).json({ error: 'Location not found' });
    return null;
  }

  for (const field of dateFields) {
    if (!ISO_DATE.test(req.body[field] || '')) {
      res.status(400).json({ error: 'Bad Request', message: `${field} must be YYYY-MM-DD` });
      return null;
    }
  }

  const mode = req.body.mode || 'merge';
  if (!DAY_MODES.includes(mode)) {
    res.status(400).json({ error: 'Bad Request', message: `mode must be one of ${DAY_MODES.join(', ')}` });
    return null;
  }

  return { location, mode };
}

// POST /api/production/bulk/move-day  { location, fromDate, toDate, mode }
router.post('/bulk/move-day', manageAccess, asyncHandler(async (req, res) => {
  const ctx = await bulkContext(req, res, ['fromDate', 'toDate']);
  if (!ctx) return;

  const result = await ProductionEntry.moveDay(
    ctx.location.id, req.body.fromDate, req.body.toDate, ctx.mode, currentUser(req)
  );
  if (result.empty) {
    return res.status(400).json({ error: 'Bad Request', message: 'That day has nothing to move' });
  }
  res.json({ data: { moved: result.moved }, undo: result.undo });
}));

// POST /api/production/bulk/swap-days  { location, dateA, dateB }
router.post('/bulk/swap-days', manageAccess, asyncHandler(async (req, res) => {
  const ctx = await bulkContext(req, res, ['dateA', 'dateB']);
  if (!ctx) return;

  if (req.body.dateA === req.body.dateB) {
    return res.status(400).json({ error: 'Bad Request', message: 'Pick two different days' });
  }

  const result = await ProductionEntry.swapDays(
    ctx.location.id, req.body.dateA, req.body.dateB, currentUser(req)
  );
  if (result.empty) {
    return res.status(400).json({ error: 'Bad Request', message: 'Both days are empty' });
  }
  res.json({ data: { swapped: result.swapped }, undo: result.undo });
}));

// POST /api/production/bulk/shift-range  { location, fromDate, toDate, days }
//
// The one from section 4.5 worth having: select a range, move everything in it
// by a number of days.
router.post('/bulk/shift-range', manageAccess, asyncHandler(async (req, res) => {
  const ctx = await bulkContext(req, res, ['fromDate', 'toDate']);
  if (!ctx) return;

  const days = Number(req.body.days);
  if (!Number.isInteger(days) || days === 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'days must be a non-zero whole number' });
  }
  // A range shift is a nudge, not a relocation across the year.
  if (Math.abs(days) > 90) {
    return res.status(400).json({ error: 'Bad Request', message: 'days must be within 90 either way' });
  }
  if (req.body.toDate < req.body.fromDate) {
    return res.status(400).json({ error: 'Bad Request', message: 'toDate must not be earlier than fromDate' });
  }

  const result = await ProductionEntry.shiftRange(
    ctx.location.id, req.body.fromDate, req.body.toDate, days, currentUser(req)
  );
  if (result.empty) {
    return res.status(400).json({ error: 'Bad Request', message: 'Nothing is planned in that range' });
  }
  res.json({ data: { shifted: result.shifted }, undo: result.undo });
}));

// POST /api/production/bulk/copy  { location, fromDate, toDate, dayCount, mode }
//
// dayCount 1 copies a day, 7 copies a week - the same operation either way.
router.post('/bulk/copy', manageAccess, asyncHandler(async (req, res) => {
  const ctx = await bulkContext(req, res, ['fromDate', 'toDate']);
  if (!ctx) return;

  const dayCount = Number(req.body.dayCount || 1);
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 31) {
    return res.status(400).json({ error: 'Bad Request', message: 'dayCount must be between 1 and 31' });
  }

  const result = await ProductionEntry.copyDays(
    ctx.location.id, req.body.fromDate, req.body.toDate, dayCount, ctx.mode, currentUser(req)
  );
  if (result.empty) {
    return res.status(400).json({ error: 'Bad Request', message: 'There is nothing to copy' });
  }
  res.json({ data: { copied: result.copied }, undo: result.undo });
}));

// POST /api/production/entries/:id/split  { keepQuantity, productionDate, shiftId }
router.post('/entries/:id/split', manageAccess, asyncHandler(async (req, res) => {
  const keepQuantity = Number(req.body.keepQuantity);
  if (!Number.isInteger(keepQuantity) || keepQuantity <= 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'keepQuantity must be a whole number of pieces' });
  }
  if (req.body.productionDate && !ISO_DATE.test(req.body.productionDate)) {
    return res.status(400).json({ error: 'Bad Request', message: 'productionDate must be YYYY-MM-DD' });
  }

  const result = await ProductionEntry.splitQuantity(
    req.params.id,
    keepQuantity,
    { productionDate: req.body.productionDate || null, shiftId: req.body.shiftId || null },
    currentUser(req)
  );

  if (result.notFound) return res.status(404).json({ error: 'Entry not found' });
  if (result.notSplittable) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'This card has no numeric quantity to split'
    });
  }
  if (result.badSplit) {
    return res.status(400).json({
      error: 'Bad Request',
      message: `The kept amount must be between 1 and ${result.total - 1}`
    });
  }
  res.json({ data: result.entry, undo: result.undo });
}));

// =========================================================
// Activity log
// =========================================================
// GET /api/production/activity?location=PO1&limit=100&entryId=42
//
// Readable by anyone who can see the plan: knowing what changed and who
// changed it is part of reading the plan, not a privilege.
router.get('/activity', viewAccess, asyncHandler(async (req, res) => {
  const location = await ProductionPlan.findLocationByCode(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const activity = await ProductionEntry.findActivity(location.id, {
    limit: req.query.limit,
    before: req.query.before ? Number(req.query.before) : null,
    entryId: req.query.entryId ? Number(req.query.entryId) : null
  });

  // The UI says how far back restoring reaches rather than letting someone
  // discover the limit by finding a Restore button missing.
  res.json({ data: activity, restoreWindowDays: ProductionRetentionService.detailDays });
}));

// POST /api/production/activity/:id/restore
//
// Puts an entry back to the state recorded before that change - the recovery
// path once the Undo toast is gone. Restoring needs production.manage, unlike
// reading the log.
router.post('/activity/:id/restore', manageAccess, asyncHandler(async (req, res) => {
  const result = await ProductionEntry.restoreFromLog(Number(req.params.id), currentUser(req));

  if (result.notFound) return res.status(404).json({ error: 'History entry not found' });
  if (result.notRestorable) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'This change recorded no previous state to restore'
    });
  }
  if (result.gone) {
    return res.status(410).json({
      error: 'Gone',
      message: 'The card was permanently removed and cannot be restored'
    });
  }
  res.json({ data: result.entry });
}));

// PUT /api/production/day-flags - mark a day free/important/urgent, or clear it
router.put('/day-flags', manageAccess, asyncHandler(async (req, res) => {
  const { location: code, date, flag, note } = req.body;

  if (!ISO_DATE.test(date || '')) {
    return res.status(400).json({ error: 'Bad Request', message: 'date must be YYYY-MM-DD' });
  }
  if (flag && !DAY_FLAGS.includes(flag)) {
    return res.status(400).json({
      error: 'Bad Request',
      message: `flag must be one of ${DAY_FLAGS.join(', ')}, or null to clear`
    });
  }

  const location = await ProductionPlan.findLocationByCode(code);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const result = await ProductionEntry.setDayFlag(location.id, date, flag || null, note, currentUser(req));

  // Live at once, like marking a card done. Free and Important say something
  // about the day, not about what to build on it - so holding them behind a
  // publish would leave the production view showing an ordinary day, and would
  // notify everyone about a plan whose work never moved.
  try {
    await ProductionRevision.patchDayFlags(location.id, date);
  } catch (error) {
    // The flag is saved either way; worst case it reaches the production view
    // at the next publish, which is where it stood before this existed.
    console.error('Could not publish the day mark straight away:', error.message);
  }

  res.json({ data: result.flag || null });
}));

// PUT /api/production/shift-notes - the note under one shift on one day.
// Blank note clears it.
router.put('/shift-notes', manageAccess, asyncHandler(async (req, res) => {
  const { location: code, date, shiftId, note } = req.body;

  if (!ISO_DATE.test(date || '')) {
    return res.status(400).json({ error: 'Bad Request', message: 'date must be YYYY-MM-DD' });
  }
  if (!Number(shiftId)) {
    return res.status(400).json({ error: 'Bad Request', message: 'shiftId is required' });
  }
  if (typeof note === 'string' && note.length > 2000) {
    return res.status(400).json({ error: 'Bad Request', message: 'note is too long (max 2000)' });
  }

  const location = await ProductionPlan.findLocationByCode(code);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const result = await ProductionEntry.setShiftNote(
    location.id, date, Number(shiftId), note, currentUser(req)
  );
  res.json({ data: result.note });
}));

module.exports = router;
