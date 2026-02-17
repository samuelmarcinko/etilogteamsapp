const GraphService = require('../services/graphService');
const User = require('../database/models/User');
const logger = require('../utils/logger');

class UserController {
  /**
   * Get all users (filters out hidden users)
   * GET /api/users
   */
  static async getUsers(req, res, next) {
    try {
      const users = await GraphService.getUsers();

      // Filter out hidden users
      const hiddenIds = await User.getHiddenUserIds();
      const visibleUsers = hiddenIds.length > 0
        ? users.filter(u => !hiddenIds.includes(u.id))
        : users;

      res.json({
        success: true,
        count: visibleUsers.length,
        data: visibleUsers
      });
    } catch (error) {
      logger.error('Error in getUsers', { error: error.message });
      next(error);
    }
  }

  /**
   * Get user by ID
   * GET /api/users/:userId
   */
  static async getUserById(req, res, next) {
    try {
      const { userId } = req.params;
      const user = await GraphService.getUserById(userId);

      res.json({
        success: true,
        data: user
      });
    } catch (error) {
      logger.error('Error in getUserById', { error: error.message });
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'User not found'
        });
      }
      next(error);
    }
  }

  /**
   * Search users
   * GET /api/users/search?q=query
   */
  static async searchUsers(req, res, next) {
    try {
      const { q } = req.query;

      if (!q || q.length < 2) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Search query must be at least 2 characters'
        });
      }

      const users = await GraphService.searchUsers(q);

      // Filter out hidden users
      const hiddenIds = await User.getHiddenUserIds();
      const visibleUsers = hiddenIds.length > 0
        ? users.filter(u => !hiddenIds.includes(u.id))
        : users;

      res.json({
        success: true,
        count: visibleUsers.length,
        data: visibleUsers
      });
    } catch (error) {
      logger.error('Error in searchUsers', { error: error.message });
      next(error);
    }
  }
}

module.exports = UserController;
