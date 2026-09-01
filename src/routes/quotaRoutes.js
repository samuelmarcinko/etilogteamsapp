const express = require('express');
const router = express.Router();
const QuotaController = require('../controllers/quotaController');
const { verifyToken } = require('../middleware/auth');
const { requireDbRole } = require('../middleware/portalAuth');
const { asyncHandler } = require('../middleware/errorHandler');

// All quota routes require authentication
router.use(verifyToken);

// User routes
router.get('/me', asyncHandler(QuotaController.getMyQuota));
router.post('/check', asyncHandler(QuotaController.checkAvailability));
router.get('/working-days', asyncHandler(QuotaController.countWorkingDays));
router.get('/holidays', asyncHandler(QuotaController.getHolidays));

// Admin and spravca routes (quota management)
router.get('/all', requireDbRole('admin', 'spravca'), asyncHandler(QuotaController.getAllQuotas));
router.get('/user/:userId', requireDbRole('admin', 'spravca'), asyncHandler(QuotaController.getUserQuota));
router.put('/user/:userId', requireDbRole('admin', 'spravca'), asyncHandler(QuotaController.updateUserQuota));

// Admin-only routes
router.get('/settings', requireDbRole('admin'), asyncHandler(QuotaController.getSettings));
router.put('/settings', requireDbRole('admin'), asyncHandler(QuotaController.updateSettings));
router.post('/initialize', requireDbRole('admin'), asyncHandler(QuotaController.initializeQuotas));

module.exports = router;
