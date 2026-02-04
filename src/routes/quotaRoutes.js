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

// Admin routes
router.get('/all', requireDbRole('admin'), asyncHandler(QuotaController.getAllQuotas));
router.get('/settings', requireDbRole('admin'), asyncHandler(QuotaController.getSettings));
router.put('/settings', requireDbRole('admin'), asyncHandler(QuotaController.updateSettings));
router.put('/user/:userId', requireDbRole('admin'), asyncHandler(QuotaController.updateUserQuota));
router.get('/user/:userId', requireDbRole('admin'), asyncHandler(QuotaController.getUserQuota));
router.post('/initialize', requireDbRole('admin'), asyncHandler(QuotaController.initializeQuotas));

module.exports = router;
