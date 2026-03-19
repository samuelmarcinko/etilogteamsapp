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
router.get('/employees', requireDbRole('admin'), asyncHandler(AdminController.getEmployees));
router.put('/employees/:userId/role', requireDbRole('admin'), asyncHandler(AdminController.updateEmployeeRole));
router.put('/employees/:userId/visibility', requireDbRole('admin'), asyncHandler(AdminController.toggleEmployeeVisibility));
router.get('/tickets', requireDbRole('admin'), asyncHandler(AdminController.getAllTickets));
router.get('/all-azure-users', requireDbRole('admin'), asyncHandler(AdminController.getAllAzureUsers));
router.get('/diagnose-user', requireDbRole('admin'), asyncHandler(AdminController.diagnoseUser));

// Data management routes (admin only)
router.get('/data/stats', requireDbRole('admin'), asyncHandler(AdminController.getDataStats));
router.delete('/data/tickets', requireDbRole('admin'), asyncHandler(AdminController.deleteAllTickets));
router.post('/data/tickets/bulk-delete', requireDbRole('admin'), asyncHandler(AdminController.bulkDeleteTickets));
router.delete('/data/tickets/:ticketId', requireDbRole('admin'), asyncHandler(AdminController.deleteTicket));
router.delete('/data/sick-notes', requireDbRole('admin'), asyncHandler(AdminController.deleteAllSickNotes));
router.delete('/data/sick-notes/:id', requireDbRole('admin'), asyncHandler(AdminController.deleteSickNote));
router.delete('/data/quotas', requireDbRole('admin'), asyncHandler(AdminController.deleteAllQuotas));
router.post('/data/quotas/reset-used', requireDbRole('admin'), asyncHandler(AdminController.resetQuotasUsed));

// Backup routes (admin only)
router.post('/backup', requireDbRole('admin'), asyncHandler(AdminController.triggerBackup));
router.get('/backups', requireDbRole('admin'), asyncHandler(AdminController.listBackups));

module.exports = router;
