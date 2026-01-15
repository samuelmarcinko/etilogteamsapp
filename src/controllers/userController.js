const GraphService = require('../services/graphService');

class UserController {
  /**
   * Get all users
   * GET /api/users
   */
  static async getUsers(req, res, next) {
    try {
      const users = await GraphService.getUsers();

      res.json({
        success: true,
        count: users.length,
        data: users
      });
    } catch (error) {
      console.error('Error in getUsers:', error);
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
      console.error('Error in getUserById:', error);
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

      res.json({
        success: true,
        count: users.length,
        data: users
      });
    } catch (error) {
      console.error('Error in searchUsers:', error);
      next(error);
    }
  }
}

module.exports = UserController;
