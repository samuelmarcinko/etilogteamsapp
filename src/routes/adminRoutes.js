const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/adminController');
const { verifyToken } = require('../middleware/auth');
const { requireDbRole, requirePermission, getAccessControlMode } = require('../middleware/portalAuth');
const { asyncHandler } = require('../middleware/errorHandler');
const Role = require('../database/models/Role');
const User = require('../database/models/User');
const SystemSettings = require('../database/models/SystemSettings');
const { sendEmail, getSmtpConfig } = require('../services/emailService');

// All admin routes require authentication
router.use(verifyToken);

// Get my profile (any authenticated user)
router.get('/me', asyncHandler(AdminController.getMyProfile));

// Admin-only routes
router.get('/stats', requireDbRole('admin'), asyncHandler(AdminController.getStats));
router.get('/diagnose-user', requireDbRole('admin'), asyncHandler(AdminController.diagnoseUser));

// Routes accessible by admin and spravca (read-only for spravca)
router.get('/employees', requirePermission('hr.manage', { legacyRoles: ['admin', 'spravca'] }), asyncHandler(AdminController.getEmployees));
router.get('/tickets', requirePermission('hr.manage', { legacyRoles: ['admin', 'spravca'] }), asyncHandler(AdminController.getAllTickets));
router.get('/all-azure-users', requirePermission('hr.manage', { legacyRoles: ['admin', 'spravca'] }), asyncHandler(AdminController.getAllAzureUsers));

// Admin-only ticket edit
router.put('/tickets/:ticketId', requireDbRole('admin'), asyncHandler(AdminController.updateTicket));

// Admin-only employee management
router.put('/employees/:userId/role', requireDbRole('admin'), asyncHandler(AdminController.updateEmployeeRole));
router.put('/employees/:userId/visibility', requireDbRole('admin'), asyncHandler(AdminController.toggleEmployeeVisibility));

// =========================================================
// Roles and permissions (admin only)
// =========================================================
// Deliberately requireDbRole('admin') rather than a permission key: this is the
// screen that edits the permission matrix, so gating it on the matrix would let
// one bad save lock everybody out of the tool that undoes it. The real admin
// role always reaches it, whatever the checkboxes say.
router.get('/roles', requireDbRole('admin'), asyncHandler(async (req, res) => {
  const [roles, userCounts] = await Promise.all([
    Role.findAllWithPermissions(),
    User.countByRole()
  ]);

  res.json({
    success: true,
    data: {
      roles: roles.map((role) => ({ ...role, userCount: userCounts[role.name] || 0 })),
      permissionKeys: Role.PERMISSION_KEYS,
      alwaysGranted: Role.ALWAYS_GRANTED,
      // The screen says which mode is live, because in legacy and shadow these
      // checkboxes are recorded but not obeyed - and an admin who does not know
      // that would think the save had failed.
      accessControlMode: getAccessControlMode()
    }
  });
}));

router.put('/roles/:name/permissions', requireDbRole('admin'), asyncHandler(async (req, res) => {
  const permissions = Array.isArray(req.body.permissions) ? req.body.permissions : null;
  if (!permissions) {
    return res.status(400).json({ error: 'Bad Request', message: 'permissions must be an array' });
  }

  const result = await Role.setPermissions(req.params.name, permissions);
  if (result.notFound) return res.status(404).json({ error: 'Role not found' });
  if (result.refused === 'admin') {
    return res.status(409).json({
      error: 'Conflict',
      message: 'The admin role always holds every permission and cannot be edited'
    });
  }
  if (result.unknownKeys) {
    return res.status(400).json({
      error: 'Bad Request',
      message: `Unknown permission(s): ${result.unknownKeys.join(', ')}`
    });
  }

  res.json({ success: true, data: result });
}));

router.post('/roles', requireDbRole('admin'), asyncHandler(async (req, res) => {
  const result = await Role.create({
    name: req.body.name,
    label: req.body.label,
    permissions: Array.isArray(req.body.permissions) ? req.body.permissions : []
  });

  if (result.badName) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Name must start with a letter and contain only lowercase letters, digits and _'
    });
  }
  if (result.exists) return res.status(409).json({ error: 'Conflict', message: 'That role already exists' });

  res.status(201).json({ success: true, data: result });
}));

router.delete('/roles/:name', requireDbRole('admin'), asyncHandler(async (req, res) => {
  const result = await Role.remove(req.params.name);
  if (result.notFound) return res.status(404).json({ error: 'Role not found' });
  if (result.refused === 'system') {
    return res.status(409).json({ error: 'Conflict', message: 'Built-in roles cannot be deleted' });
  }
  if (result.inUse) {
    return res.status(409).json({
      error: 'Conflict',
      message: `${result.inUse} user(s) still hold this role - move them to another role first`
    });
  }

  res.json({ success: true, data: result });
}));

// Data management routes (admin only)
router.get('/data/stats', requireDbRole('admin'), asyncHandler(AdminController.getDataStats));
router.delete('/data/tickets', requireDbRole('admin'), asyncHandler(AdminController.deleteAllTickets));
router.post('/data/tickets/bulk-delete', requireDbRole('admin'), asyncHandler(AdminController.bulkDeleteTickets));
router.delete('/data/tickets/:ticketId', requireDbRole('admin'), asyncHandler(AdminController.deleteTicket));
router.delete('/data/sick-notes', requireDbRole('admin'), asyncHandler(AdminController.deleteAllSickNotes));
router.post('/data/sick-notes/bulk-delete', requireDbRole('admin'), asyncHandler(AdminController.bulkDeleteSickNotes));
router.delete('/data/sick-notes/:id', requireDbRole('admin'), asyncHandler(AdminController.deleteSickNote));
router.delete('/data/quotas', requireDbRole('admin'), asyncHandler(AdminController.deleteAllQuotas));
router.post('/data/quotas/reset-used', requireDbRole('admin'), asyncHandler(AdminController.resetQuotasUsed));

// Backup routes (admin only)
router.post('/backup', requireDbRole('admin'), asyncHandler(AdminController.triggerBackup));
router.get('/backups', requireDbRole('admin'), asyncHandler(AdminController.listBackups));

// Export routes (admin and spravca)
router.get('/export/tickets', requirePermission('hr.manage', { legacyRoles: ['admin', 'spravca'] }), asyncHandler(AdminController.exportTickets));

// SMTP Settings (admin only)
router.get('/settings/smtp', requireDbRole('admin'), asyncHandler(async (req, res) => {
  const settings = await SystemSettings.getByPrefix('smtp.');
  const config = await getSmtpConfig();
  res.json({
    success: true,
    data: {
      host: settings['smtp.host'] || process.env.SMTP_HOST || '',
      port: settings['smtp.port'] || process.env.SMTP_PORT || '587',
      user: settings['smtp.user'] || process.env.SMTP_USER || '',
      pass: (settings['smtp.pass'] || process.env.SMTP_PASS) ? '***' : '',
      from: settings['smtp.from'] || process.env.SMTP_FROM || '',
      configured: !!(config.host && config.user && config.pass)
    }
  });
}));

router.put('/settings/smtp', requireDbRole('admin'), asyncHandler(async (req, res) => {
  const { host, port, user, pass, from } = req.body;
  const toSave = {};
  if (host !== undefined) toSave['smtp.host'] = host;
  if (port !== undefined) toSave['smtp.port'] = String(port);
  if (user !== undefined) toSave['smtp.user'] = user;
  if (from !== undefined) toSave['smtp.from'] = from;
  // Only update password if a new non-empty value was provided
  if (pass && pass !== '***') toSave['smtp.pass'] = pass;

  await SystemSettings.setMany(toSave);
  res.json({ success: true, message: 'SMTP nastavenia uložené' });
}));

router.post('/settings/smtp/test', requireDbRole('admin'), asyncHandler(async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ success: false, message: 'Chýba cieľová emailová adresa' });

  const sent = await sendEmail({
    to,
    subject: 'ETILOG – Test SMTP',
    html: `<p>Test SMTP konfigurácie bol úspešný.</p><p>Odoslaný: ${new Date().toLocaleString('sk-SK')}</p>`
  });

  if (sent) {
    res.json({ success: true, message: `Testovací email odoslaný na ${to}` });
  } else {
    res.status(500).json({ success: false, message: 'SMTP nie je nakonfigurované alebo odosielanie zlyhalo' });
  }
}));

module.exports = router;
