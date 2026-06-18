const express = require('express');
const router = express.Router();
const Material = require('../database/models/Material');
const MaterialCategory = require('../database/models/MaterialCategory');
const PalletLocation = require('../database/models/PalletLocation');
const WarehouseAudit = require('../database/models/WarehouseAudit');
const { verifyToken } = require('../middleware/auth');
const { attachDbRole, requireDbRole } = require('../middleware/portalAuth');
const { asyncHandler } = require('../middleware/errorHandler');

// All warehouse routes require admin or sklad (warehouse manager) role
router.use(verifyToken, attachDbRole, requireDbRole('admin', 'sklad'));

// Admin-only gate (for audit log)
function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin only' });
  }
  next();
}

const currentUser = (req) => ({ id: req.user.id, name: req.user.name || req.user.email });

// =========================================================
// Dashboard / stats
// =========================================================
// GET /api/warehouse/stats
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await Material.getStats();
  res.json({ data: stats });
}));

// =========================================================
// Pallet locations
// =========================================================
// GET /api/warehouse/locations - all locations with material summary (for map)
router.get('/locations', asyncHandler(async (req, res) => {
  const locations = await PalletLocation.findAllWithSummary();
  res.json({ data: locations });
}));

// GET /api/warehouse/locations/:id/materials - materials at a location (modal)
router.get('/locations/:id/materials', asyncHandler(async (req, res) => {
  const location = await PalletLocation.findById(req.params.id);
  if (!location) return res.status(404).json({ error: 'Location not found' });
  const materials = await Material.findByLocationId(req.params.id);
  res.json({ data: { location, materials } });
}));

// PUT /api/warehouse/locations/:id/notes - update location notes
router.put('/locations/:id/notes', asyncHandler(async (req, res) => {
  const location = await PalletLocation.updateNotes(req.params.id, req.body.notes);
  if (!location) return res.status(404).json({ error: 'Location not found' });
  res.json({ data: location });
}));

// =========================================================
// Categories
// =========================================================
// GET /api/warehouse/categories
router.get('/categories', asyncHandler(async (req, res) => {
  const categories = await MaterialCategory.findAll();
  res.json({ data: categories });
}));

// POST /api/warehouse/categories
router.post('/categories', asyncHandler(async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'name is required' });
  const category = await MaterialCategory.create(req.body);
  await WarehouseAudit.log(currentUser(req), 'created', 'category', category.id, { name: category.name });
  res.status(201).json({ data: category });
}));

// PUT /api/warehouse/categories/:id
router.put('/categories/:id', asyncHandler(async (req, res) => {
  const category = await MaterialCategory.update(req.params.id, req.body);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  await WarehouseAudit.log(currentUser(req), 'updated', 'category', category.id, { name: category.name });
  res.json({ data: category });
}));

// DELETE /api/warehouse/categories/:id
router.delete('/categories/:id', asyncHandler(async (req, res) => {
  await MaterialCategory.delete(req.params.id);
  await WarehouseAudit.log(currentUser(req), 'deleted', 'category', Number(req.params.id));
  res.json({ message: 'Category deleted' });
}));

// =========================================================
// Movements history
// =========================================================
// GET /api/warehouse/movements?material_id=
router.get('/movements', asyncHandler(async (req, res) => {
  const movements = await Material.getMovements(req.query.material_id || null);
  res.json({ data: movements });
}));

// =========================================================
// Audit log (admin only)
// =========================================================
// GET /api/warehouse/audit
router.get('/audit', requireAdmin, asyncHandler(async (req, res) => {
  const log = await WarehouseAudit.findAll({ entity: req.query.entity || null });
  res.json({ data: log });
}));

// =========================================================
// Materials (CRUD + search + move)
// =========================================================
// GET /api/warehouse/materials?search=&zone=&category_id=
router.get('/materials', asyncHandler(async (req, res) => {
  const materials = await Material.findAll({
    search: req.query.search,
    zone: req.query.zone,
    category_id: req.query.category_id
  });
  res.json({ data: materials });
}));

// GET /api/warehouse/materials/:id
router.get('/materials/:id', asyncHandler(async (req, res) => {
  const material = await Material.findById(req.params.id);
  if (!material) return res.status(404).json({ error: 'Material not found' });
  res.json({ data: material });
}));

// POST /api/warehouse/materials
router.post('/materials', asyncHandler(async (req, res) => {
  const { code, name } = req.body;
  if (!code || !name) {
    return res.status(400).json({ error: 'code and name are required' });
  }
  // App-level duplicate guard (DB UNIQUE added later once legacy dupes cleaned)
  if (await Material.existsByCode(code)) {
    return res.status(409).json({ error: 'code exists', message: 'Material with this code already exists' });
  }
  const user = currentUser(req);
  const material = await Material.create({ ...req.body, created_by: user.id, created_by_name: user.name });
  const placements = Array.isArray(req.body.placements) ? req.body.placements.filter(p => p.location_id) : [];
  await WarehouseAudit.log(user, 'created', 'material', material.id, {
    code: material.code, name: material.name,
    placements: placements.map(p => ({ location_id: p.location_id, quantity: p.quantity }))
  });
  res.status(201).json({ data: material });
}));

// PUT /api/warehouse/materials/:id
router.put('/materials/:id', asyncHandler(async (req, res) => {
  // Duplicate guard when code is being changed
  if (req.body.code && await Material.existsByCode(req.body.code, Number(req.params.id))) {
    return res.status(409).json({ error: 'code exists', message: 'Material with this code already exists' });
  }
  const material = await Material.update(req.params.id, req.body);
  if (!material) return res.status(404).json({ error: 'Material not found' });
  const placements = Array.isArray(req.body.placements) ? req.body.placements.filter(p => p.location_id) : [];
  await WarehouseAudit.log(currentUser(req), 'updated', 'material', material.id, {
    code: material.code,
    placements: placements.map(p => ({ location_id: p.location_id, quantity: p.quantity }))
  });
  res.json({ data: material });
}));

// PATCH /api/warehouse/materials/:id/move - relocate to new pallet location
router.patch('/materials/:id/move', asyncHandler(async (req, res) => {
  const { to_location_id, reason } = req.body;
  const material = await Material.move(req.params.id, to_location_id, currentUser(req), reason);
  if (!material) return res.status(404).json({ error: 'Material not found' });
  const mi = material._moveInfo || {};
  await WarehouseAudit.log(currentUser(req), 'moved', 'material', material.id, {
    from_location_code: mi.fromCode || null,
    to_location_code: mi.toCode || null
  });
  delete material._moveInfo;
  res.json({ data: material });
}));

// DELETE /api/warehouse/materials/:id
router.delete('/materials/:id', asyncHandler(async (req, res) => {
  const mat = await Material.findById(req.params.id);
  await Material.delete(req.params.id);
  await WarehouseAudit.log(currentUser(req), 'deleted', 'material', Number(req.params.id), {
    code: mat?.code || null,
    name: mat?.name || null
  });
  res.json({ message: 'Material deleted' });
}));

module.exports = router;
