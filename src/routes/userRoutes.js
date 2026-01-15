const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');
const { optionalAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// Optional auth - works without token for development
router.use(optionalAuth);

// Search users
router.get('/search', asyncHandler(UserController.searchUsers));

// Get all users
router.get('/', asyncHandler(UserController.getUsers));

// Get user by ID
router.get('/:userId', asyncHandler(UserController.getUserById));

module.exports = router;
