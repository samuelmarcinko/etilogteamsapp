const express = require('express');
const router = express.Router();
const ProductionPlan = require('../database/models/ProductionPlan');
const { verifyToken } = require('../middleware/auth');
const { attachDbRole, requirePermission } = require('../middleware/portalAuth');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * Production Plan API.
 *
 * Read-only for now - the planner grid and viewer. Editing, drag & drop and
 * draft/publish arrive in their own steps.
 *
 * Gating: production.view to read, production.manage to change anything. Today
 * only admin holds either, which is why legacyRoles is ['admin'] - it keeps the
 * shadow comparison meaningful for these routes too.
 */
const viewAccess = [verifyToken, attachDbRole,
  requirePermission('production.view', { legacyRoles: ['admin'] })];

// Kept for the first write endpoints; referenced here so the intent is visible.
// eslint-disable-next-line no-unused-vars
const manageAccess = [verifyToken, attachDbRole,
  requirePermission('production.manage', { legacyRoles: ['admin'] })];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

module.exports = router;
