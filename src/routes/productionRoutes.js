const express = require('express');
const router = express.Router();
const ProductionPlan = require('../database/models/ProductionPlan');
const ProductionEntry = require('../database/models/ProductionEntry');
const { verifyToken } = require('../middleware/auth');
const { attachDbRole, requirePermission } = require('../middleware/portalAuth');
const { asyncHandler } = require('../middleware/errorHandler');
const ProductionRetentionService = require('../services/productionRetentionService');

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

const PRIORITIES = ['normal', 'high', 'urgent', 'blocked'];
const STATUSES = ['planned', 'in_progress', 'done', 'cancelled'];
const DAY_FLAGS = ['free', 'critical', 'urgent'];

/**
 * Validate and normalise a card payload.
 *
 * Returns { error } or { value }. Quantity accepts either a plain number or a
 * string like "130+22", which is kept verbatim in raw_quantity while the parts
 * and their total go into the structured columns - the Excel data has both
 * shapes and neither should be lost.
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

  value.status = body.status || 'planned';
  if (!STATUSES.includes(value.status)) {
    return { error: `status must be one of ${STATUSES.join(', ')}` };
  }

  value.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

  return { value };
}

function parseQuantity(input) {
  if (input == null || input === '') {
    return { value: { plannedQuantity: null, quantityBreakdown: null, rawQuantity: null } };
  }

  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return { error: 'quantity must be a positive number' };
    return { value: { plannedQuantity: input, quantityBreakdown: null, rawQuantity: null } };
  }

  const raw = String(input).trim();

  // "130+22" and friends: keep the original string, store the parts and total.
  if (/^\d+(\s*\+\s*\d+)+$/.test(raw)) {
    const parts = raw.split('+').map((p) => Number(p.trim()));
    return {
      value: {
        plannedQuantity: parts.reduce((a, b) => a + b, 0),
        quantityBreakdown: { parts },
        rawQuantity: raw
      }
    };
  }

  const single = Number(raw);
  if (Number.isFinite(single) && single >= 0) {
    return { value: { plannedQuantity: single, quantityBreakdown: null, rawQuantity: null } };
  }

  // Anything else is kept verbatim rather than rejected; the sheets contain
  // values a number cannot express and losing them would be worse.
  return { value: { plannedQuantity: null, quantityBreakdown: null, rawQuantity: raw } };
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

  const [shifts, entries, dayFlags, exceptions] = await Promise.all([
    ProductionPlan.findShifts(location.id),
    ProductionPlan.findEntries(location.id, from, to),
    ProductionPlan.findDayFlags(location.id, from, to),
    ProductionPlan.findCalendarExceptions(location.id, from, to)
  ]);

  res.json({
    data: {
      location,
      range: { from, to },
      shifts,
      entries,
      dayFlags,
      calendarExceptions: exceptions
    }
  });
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

  if (Array.isArray(deleteIds) && deleteIds.length > 0) {
    const result = await ProductionEntry.hardDelete(deleteIds.map(Number), currentUser(req));
    return res.json({ data: result });
  }

  if (!Array.isArray(positions) || positions.length === 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'positions or deleteIds is required' });
  }

  const result = await ProductionEntry.restorePositions(positions, currentUser(req));
  res.json({ data: result.restored });
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

// PUT /api/production/day-flags - mark a day free/critical/urgent, or clear it
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
  res.json({ data: result.flag || null });
}));

module.exports = router;
