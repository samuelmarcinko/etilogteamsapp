const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/adminController');
const { verifyToken } = require('../middleware/auth');
const { requireDbRole } = require('../middleware/portalAuth');
const { asyncHandler } = require('../middleware/errorHandler');
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
