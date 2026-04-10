const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/adminController');
const { verifyToken } = require('../middleware/auth');
const { requireDbRole } = require('../middleware/portalAuth');
const { asyncHandler } = require('../middleware/errorHandler');

// All admin routes require authentication
router.use(verifyToken);

// Get my profile (any authenticated user)
router.get('/me', asyncHandler(AdminController.getMyProfile));

// Admin-only routes
router.get('/stats', requireDbRole('admin'), asyncHandler(AdminController.getStats));
router.get('/diagnose-user', requireDbRole('admin'), asyncHandler(AdminController.diagnoseUser));

// Routes accessible by admin and spravca (read-only for spravca)
router.get('/employees', requireDbRole('admin', 'spravca'), asyncHandler(AdminController.getEmployees));
router.get('/tickets', requireDbRole('admin', 'spravca'), asyncHandler(AdminController.getAllTickets));
router.get('/all-azure-users', requireDbRole('admin', 'spravca'), asyncHandler(AdminController.getAllAzureUsers));

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
router.get('/export/tickets', requireDbRole('admin', 'spravca'), asyncHandler(AdminController.exportTickets));

module.exports = router;
