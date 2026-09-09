const express = require('express');
const router = express.Router();
const Material = require('../database/models/Material');
const MaterialCategory = require('../database/models/MaterialCategory');
const PalletLocation = require('../database/models/PalletLocation');
const WarehouseAudit = require('../database/models/WarehouseAudit');
const WarehouseBackupService = require('../services/warehouseBackupService');
const warehouseBackup = new WarehouseBackupService();
const WarehouseSyncService = require('../services/warehouseSyncService');
const { verifyToken } = require('../middleware/auth');
const { attachDbRole, requirePermission } = require('../middleware/portalAuth');
const { asyncHandler } = require('../middleware/errorHandler');

// Middleware chains: read (GET) vs write (POST/PUT/PATCH/DELETE)
const readAccess = [verifyToken, attachDbRole,
  requirePermission('warehouse.read', { legacyRoles: ['admin', 'sklad', 'sklad_read'] })];
const writeAccess = [verifyToken, attachDbRole,
  requirePermission('warehouse.write', { legacyRoles: ['admin', 'sklad'] })];

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
router.get('/stats', readAccess, asyncHandler(async (req, res) => {
  const stats = await Material.getStats();
  res.json({ data: stats });
}));

// =========================================================
// Pallet locations
// =========================================================
// GET /api/warehouse/locations - all locations with material summary (for map)
router.get('/locations', readAccess, asyncHandler(async (req, res) => {
  const locations = await PalletLocation.findAllWithSummary();
  res.json({ data: locations });
}));

// GET /api/warehouse/locations/:id/materials - materials at a location (modal)
router.get('/locations/:id/materials', readAccess, asyncHandler(async (req, res) => {
  const location = await PalletLocation.findById(req.params.id);
  if (!location) return res.status(404).json({ error: 'Location not found' });
  const materials = await Material.findByLocationId(req.params.id);
  res.json({ data: { location, materials } });
}));

// PUT /api/warehouse/locations/:id/notes - update location notes
router.put('/locations/:id/notes', writeAccess, asyncHandler(async (req, res) => {
  const location = await PalletLocation.updateNotes(req.params.id, req.body.notes);
  if (!location) return res.status(404).json({ error: 'Location not found' });
  res.json({ data: location });
}));

// =========================================================
// Categories
// =========================================================
// GET /api/warehouse/categories
router.get('/categories', readAccess, asyncHandler(async (req, res) => {
  const categories = await MaterialCategory.findAll();
  res.json({ data: categories });
}));

// POST /api/warehouse/categories
router.post('/categories', writeAccess, asyncHandler(async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'name is required' });
  const category = await MaterialCategory.create(req.body);
  await WarehouseAudit.log(currentUser(req), 'created', 'category', category.id, { name: category.name });
  res.status(201).json({ data: category });
}));

// PUT /api/warehouse/categories/:id
router.put('/categories/:id', writeAccess, asyncHandler(async (req, res) => {
  const category = await MaterialCategory.update(req.params.id, req.body);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  await WarehouseAudit.log(currentUser(req), 'updated', 'category', category.id, { name: category.name });
  res.json({ data: category });
}));

// DELETE /api/warehouse/categories/:id
router.delete('/categories/:id', writeAccess, asyncHandler(async (req, res) => {
  await MaterialCategory.delete(req.params.id);
  await WarehouseAudit.log(currentUser(req), 'deleted', 'category', Number(req.params.id));
  res.json({ message: 'Category deleted' });
}));

// =========================================================
// Movements / activity feed
// =========================================================
// GET /api/warehouse/movements?action=&search=
// Unified feed: created / updated / deleted / moved (from the audit log).
router.get('/movements', readAccess, asyncHandler(async (req, res) => {
  const feed = await WarehouseAudit.findFeed({
    action: req.query.action || null,
    search: req.query.search || null
  });
  res.json({ data: feed });
}));

// Helper: compact placements [{code, quantity}] from a full material row
const placementSnapshot = (mat) =>
  (Array.isArray(mat?.placements) ? mat.placements : [])
    .map(p => ({ code: p.location_code, quantity: p.quantity }));

// =========================================================
// Audit log (admin only)
// =========================================================
// GET /api/warehouse/audit
router.get('/audit', readAccess, requireAdmin, asyncHandler(async (req, res) => {
  const log = await WarehouseAudit.findAll({ entity: req.query.entity || null });
  res.json({ data: log });
}));

// =========================================================
// Warehouse backups (admin only) — separate from the full-app backup
// =========================================================
// GET /api/warehouse/backups — list available warehouse snapshots
router.get('/backups', readAccess, requireAdmin, asyncHandler(async (req, res) => {
  res.json({ data: warehouseBackup.listBackups() });
}));

// POST /api/warehouse/backups — create a snapshot now
router.post('/backups', readAccess, requireAdmin, asyncHandler(async (req, res) => {
  const info = await warehouseBackup.createBackup('manual');
  await WarehouseAudit.log(currentUser(req), 'backup', 'warehouse', null, { name: info.name, counts: info.counts });
  res.status(201).json({ data: info });
}));

// POST /api/warehouse/backups/:name/restore — restore from a snapshot (destructive)
router.post('/backups/:name/restore', readAccess, requireAdmin, asyncHandler(async (req, res) => {
  try {
    const result = await warehouseBackup.restoreBackup(req.params.name);
    await WarehouseAudit.log(currentUser(req), 'restore', 'warehouse', null, { name: req.params.name, restored: result.restored });
    res.json({ data: result });
  } catch (e) {
    if (e.message === 'Backup not found') return res.status(404).json({ error: e.message });
    if (e.message === 'Invalid backup file') return res.status(400).json({ error: e.message });
    throw e;
  }
}));

// =========================================================
// Materials (CRUD + search + move)
// =========================================================
// GET /api/warehouse/materials?search=&zone=&category_id=
router.get('/materials', readAccess, asyncHandler(async (req, res) => {
  const materials = await Material.findAll({
    search: req.query.search,
    zone: req.query.zone,
    category_id: req.query.category_id
  });
  res.json({ data: materials });
}));

// GET /api/warehouse/materials/:id
router.get('/materials/:id', readAccess, asyncHandler(async (req, res) => {
  const material = await Material.findById(req.params.id);
  if (!material) return res.status(404).json({ error: 'Material not found' });
  res.json({ data: material });
}));

// POST /api/warehouse/materials
router.post('/materials', writeAccess, asyncHandler(async (req, res) => {
  const { code, name } = req.body;

  // Poznámka skladu kód nemá - nesie ju názov a projekt, ku ktorému patrí.
  // Položka zo SAPu ho má vždy, inak by nebolo čo synchronizovať.
  const isLocal = req.body.kind === 'local';
  if (!name || (!isLocal && !code)) {
    return res.status(400).json({ error: isLocal ? 'name is required' : 'code and name are required' });
  }
  // App-level duplicate guard (DB UNIQUE added later once legacy dupes cleaned)
  if (await Material.existsByCode(code)) {
    return res.status(409).json({ error: 'code exists', message: 'Material with this code already exists' });
  }
  const user = currentUser(req);
  const material = await Material.create({ ...req.body, created_by: user.id, created_by_name: user.name });
  const full = await Material.findById(material.id);
  await WarehouseAudit.log(user, 'created', 'material', material.id, {
    code: material.code, name: material.name,
    quantity: full?.quantity ?? null,
    placements: placementSnapshot(full)
  });
  res.status(201).json({ data: material });
}));

// PUT /api/warehouse/materials/:id
router.put('/materials/:id', writeAccess, asyncHandler(async (req, res) => {
  // Duplicate guard when code is being changed
  if (req.body.code && await Material.existsByCode(req.body.code, Number(req.params.id))) {
    return res.status(409).json({ error: 'code exists', message: 'Material with this code already exists' });
  }
  // Snapshot before-state so the movement can show exactly what changed
  const before = await Material.findById(req.params.id);
  const material = await Material.update(req.params.id, req.body);
  if (!material) return res.status(404).json({ error: 'Material not found' });
  const after = await Material.findById(material.id);
  await WarehouseAudit.log(currentUser(req), 'updated', 'material', material.id, {
    code: material.code,
    name: after?.name ?? before?.name ?? null,
    quantity_before: before?.quantity ?? null,
    quantity_after: after?.quantity ?? null,
    placements_before: placementSnapshot(before),
    placements_after: placementSnapshot(after)
  });
  res.json({ data: material });
}));

// PATCH /api/warehouse/materials/:id/move - relocate to new pallet location
router.patch('/materials/:id/move', writeAccess, asyncHandler(async (req, res) => {
  const { to_location_id, reason } = req.body;
  const material = await Material.move(req.params.id, to_location_id, currentUser(req), reason);
  if (!material) return res.status(404).json({ error: 'Material not found' });
  const mi = material._moveInfo || {};
  await WarehouseAudit.log(currentUser(req), 'moved', 'material', material.id, {
    code: material.code,
    from_location_code: mi.fromCode || null,
    to_location_code: mi.toCode || null,
    quantity: material.quantity ?? null,
    reason: reason || null
  });
  delete material._moveInfo;
  res.json({ data: material });
}));

// DELETE /api/warehouse/materials/:id
router.delete('/materials/:id', writeAccess, asyncHandler(async (req, res) => {
  const mat = await Material.findById(req.params.id);
  await Material.delete(req.params.id, currentUser(req));   // soft delete
  await WarehouseAudit.log(currentUser(req), 'deleted', 'material', Number(req.params.id), {
    code: mat?.code || null,
    name: mat?.name || null,
    quantity: mat?.quantity ?? null,
    placements: placementSnapshot(mat)   // positions freed (kept for restore)
  });
  res.json({ message: 'Material deleted' });
}));

// POST /api/warehouse/materials/:id/restore - undo a soft delete
router.post('/materials/:id/restore', writeAccess, asyncHandler(async (req, res) => {
  const material = await Material.restore(req.params.id);
  if (!material) return res.status(404).json({ error: 'Material not found or not deleted' });
  const full = await Material.findById(material.id);
  await WarehouseAudit.log(currentUser(req), 'restored', 'material', material.id, {
    code: material.code,
    name: material.name,
    quantity: full?.quantity ?? null,
    placements: placementSnapshot(full)   // positions brought back
  });
  res.json({ data: material });
}));

// =========================================================
// Synchronizácia so SAPom (sklad 02-03)
// =========================================================

// GET /api/warehouse/sync - stav: kedy naposledy, ako dopadla, či prepisuje
//
// Čítacie právo stačí: skladník, ktorý sa pozerá na počet, má rovnaké právo
// vedieť, či je z dneška alebo spred týždňa.
router.get('/sync', readAccess, asyncHandler(async (req, res) => {
  const [last, apply] = await Promise.all([
    WarehouseSyncService.lastRun(),
    WarehouseSyncService.applyEnabled()
  ]);

  res.json({
    data: {
      warehouse: WarehouseSyncService.WAREHOUSE,
      schedule: WarehouseSyncService.SCHEDULE,
      // Zapisuje sa už aj do počtov, alebo sa zatiaľ len zaznamenáva, čo SAP
      // hovorí? Kým je to false, na obrazovke sa nič nemení.
      applyingQuantities: apply,
      lastRun: last
    }
  });
}));

// GET /api/warehouse/sap/item/:code - jedna položka zo SAPu, pre formulár
//
// Zámerne presné vyhľadanie kódu, nie vyhľadávanie podľa názvu: skladník kód
// odpisuje z etikety a chce vedieť, či existuje. Fulltext cez celý číselník
// SAPu by bol iný nástroj na inú otázku.
router.get('/sap/item/:code', writeAccess, asyncHandler(async (req, res) => {
  let item;
  try {
    item = await WarehouseSyncService.shared().lookup(req.params.code);
  } catch (error) {
    // Nedostupný SAP sa povie a nezamlčí. Ticho prepnúť na ručné zadanie by
    // vyrobilo presne ten typ riadku, ktorý sa touto zmenou upratuje.
    return res.status(502).json({
      error: 'Bad Gateway',
      message: `SAP neodpovedal: ${error.message}`
    });
  }

  if (!item) {
    return res.status(404).json({ error: 'Not Found', message: 'SAP taký kód nepozná' });
  }

  // Kód, ktorý v evidencii už je, nie je chyba - je to otázka „nechceš otvoriť
  // ten existujúci?". Odpoveď na ňu patrí do dialógu, nie do chybovej hlášky.
  const existing = await Material.findByCode(item.code);

  res.json({ data: { ...item, existing: existing || null } });
}));

// POST /api/warehouse/sync - spustiť teraz
router.post('/sync', writeAccess, asyncHandler(async (req, res) => {
  const result = await WarehouseSyncService.shared()
    .runOnce({ triggeredBy: currentUser(req).name });

  if (result.skipped) {
    return res.status(409).json({ error: 'Conflict', message: `Synchronizácia ${result.skipped}` });
  }
  res.json({ data: result });
}));

// POST /api/warehouse/sync/apply - zapnúť/vypnúť prepisovanie počtov
//
// Admin, nie sklad: je to rozhodnutie o tom, kto vlastní číslo, nie denná
// práca so skladom.
router.post('/sync/apply', writeAccess, requireAdmin, asyncHandler(async (req, res) => {
  if (typeof req.body.enabled !== 'boolean') {
    return res.status(400).json({ error: 'Bad Request', message: 'enabled must be true or false' });
  }
  const enabled = await WarehouseSyncService.setApplyEnabled(req.body.enabled);
  await WarehouseAudit.log(currentUser(req), 'updated', 'sync', null, {
    setting: 'warehouse.sync.apply', enabled
  });
  res.json({ data: { applyingQuantities: enabled } });
}));

// POST /api/warehouse/sync/:id/revert - vrátiť počty, ktoré jeden beh prepísal
router.post('/sync/:id/revert', writeAccess, requireAdmin, asyncHandler(async (req, res) => {
  const result = await WarehouseSyncService.revert(Number(req.params.id));
  if (result.notFound) return res.status(404).json({ error: 'Sync run not found' });

  await WarehouseAudit.log(currentUser(req), 'restored', 'sync', Number(req.params.id), {
    restored: result.restored, reason: result.reason || null
  });
  res.json({ data: result });
}));

module.exports = router;
