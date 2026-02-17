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

module.exports = router;
