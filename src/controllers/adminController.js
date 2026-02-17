const pool = require('../database/config');
const User = require('../database/models/User');
const Quota = require('../database/models/Quota');
const GraphService = require('../services/graphService');

class AdminController {
  /**
   * Get admin dashboard stats
   * GET /api/admin/stats
   */
  static async getStats(req, res, next) {
    try {
      const year = parseInt(req.query.year) || new Date().getFullYear();

      // Get multiple stats in parallel
      const [ticketStats, quotaStats, sickNoteStats, userCount] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pending,
            COUNT(CASE WHEN status = 'Approved' THEN 1 END) as approved,
            COUNT(CASE WHEN status = 'Rejected' THEN 1 END) as rejected,
            COUNT(CASE WHEN ticket_type = 'vacation' AND status = 'Approved' THEN 1 END) as approved_vacations,
            COUNT(CASE WHEN ticket_type = 'sick-leave' AND status = 'Approved' THEN 1 END) as approved_sick_leaves,
            COUNT(CASE WHEN ticket_type = 'paragraph' AND status = 'Approved' THEN 1 END) as approved_paragraphs,
            COUNT(CASE WHEN ticket_type = 'ocr' AND status = 'Approved' THEN 1 END) as approved_ocr
          FROM tickets
          WHERE EXTRACT(YEAR FROM created_at) = $1
        `, [year]),
        pool.query(`
          SELECT
            COALESCE(SUM(vacation_days_used), 0) as total_vacation_used,
            COALESCE(SUM(sick_days_used), 0) as total_sick_used,
            COALESCE(SUM(paragraph_days_used), 0) as total_paragraph_used,
            COALESCE(SUM(ocr_days_used), 0) as total_ocr_used,
            COUNT(*) as employees_with_quotas
          FROM employee_quotas WHERE year = $1
        `, [year]),
        pool.query(`
          SELECT
            COUNT(*) as total_sick_notes,
            COUNT(CASE WHEN status = 'active' THEN 1 END) as active_sick_notes
          FROM sick_notes
          WHERE EXTRACT(YEAR FROM start_date) = $1
        `, [year]),
        pool.query('SELECT COUNT(*) as count FROM users')
      ]);

      res.json({
        success: true,
        data: {
          year,
          tickets: ticketStats.rows[0],
          quotas: quotaStats.rows[0],
          sickNotes: sickNoteStats.rows[0],
          totalUsers: parseInt(userCount.rows[0].count)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all employees with their roles
   * GET /api/admin/employees
   */
  static async getEmployees(req, res, next) {
    try {
      const year = parseInt(req.query.year) || new Date().getFullYear();

      // Get users from Graph API
      const graphUsers = await GraphService.getUsers();

      // Get DB users with roles and quotas
      const dbUsers = await pool.query(
        `SELECT u.*, eq.vacation_days_total, eq.vacation_days_used,
                eq.sick_days_total, eq.sick_days_used,
                eq.paragraph_days_total, eq.paragraph_days_used,
                eq.ocr_days_total, eq.ocr_days_used
         FROM users u
         LEFT JOIN employee_quotas eq ON u.user_id = eq.user_id AND eq.year = $1
         ORDER BY u.display_name`,
        [year]
      );

      // Merge Graph and DB data
      const dbMap = new Map(dbUsers.rows.map(u => [u.user_id, u]));
      const employees = graphUsers.map(gu => {
        const dbUser = dbMap.get(gu.id);
        return {
          id: gu.id,
          name: gu.name,
          email: gu.email,
          role: dbUser?.role || 'user',
          hidden: dbUser?.hidden || false,
          vacation_days_total: dbUser?.vacation_days_total || null,
          vacation_days_used: dbUser?.vacation_days_used || 0,
          sick_days_total: dbUser?.sick_days_total || null,
          sick_days_used: dbUser?.sick_days_used || 0,
          paragraph_days_total: dbUser?.paragraph_days_total || null,
          paragraph_days_used: parseFloat(dbUser?.paragraph_days_used || 0),
          ocr_days_total: dbUser?.ocr_days_total || null,
          ocr_days_used: parseFloat(dbUser?.ocr_days_used || 0)
        };
      });

      res.json({
        success: true,
        count: employees.length,
        data: employees
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update employee role
   * PUT /api/admin/employees/:userId/role
   */
  static async updateEmployeeRole(req, res, next) {
    try {
      const { userId } = req.params;
      const { role } = req.body;

      if (!['admin', 'user'].includes(role)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Role must be "admin" or "user"'
        });
      }

      // Ensure user exists in DB first
      const graphUser = await GraphService.getUserById(userId);
      await User.upsert({
        userId: graphUser.id,
        email: graphUser.email,
        displayName: graphUser.name,
        role
      });

      const updated = await User.updateRole(userId, role);

      res.json({
        success: true,
        message: `Role updated to ${role}`,
        data: updated
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Toggle employee visibility (hidden/visible)
   * PUT /api/admin/employees/:userId/visibility
   */
  static async toggleEmployeeVisibility(req, res, next) {
    try {
      const { userId } = req.params;

      // Ensure user exists in DB first
      const graphUser = await GraphService.getUserById(userId);
      await User.upsert({
        userId: graphUser.id,
        email: graphUser.email,
        displayName: graphUser.name,
        role: 'user'
      });

      const updated = await User.toggleHidden(userId);

      res.json({
        success: true,
        message: updated.hidden ? 'User hidden from approver list' : 'User visible in approver list',
        data: { hidden: updated.hidden }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get current user profile with role
   * GET /api/admin/me
   */
  static async getMyProfile(req, res, next) {
    try {
      const userId = req.user.id;
      const userEmail = req.user.email;

      // Check DB for role - first by user_id, then by email
      let dbUser = await User.findByUserId(userId);

      if (!dbUser && userEmail) {
        dbUser = await User.findByEmail(userEmail);
        if (dbUser) {
          // Found by email - update user_id to match Azure AD oid
          await pool.query(
            'UPDATE users SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2',
            [userId, userEmail]
          );
        }
      }

      if (!dbUser) {
        // Create user in DB
        dbUser = await User.upsert({
          userId: req.user.id,
          email: req.user.email,
          displayName: req.user.name,
          role: 'user'
        });
      }

      const year = new Date().getFullYear();
      const quota = await Quota.getOrCreate(userId, year);

      res.json({
        success: true,
        data: {
          id: req.user.id,
          email: req.user.email,
          name: req.user.name,
          role: dbUser.role,
          quota: quota ? {
            year,
            vacation_days_total: quota.vacation_days_total,
            vacation_days_used: parseFloat(quota.vacation_days_used),
            vacation_days_remaining: quota.vacation_days_total - parseFloat(quota.vacation_days_used),
            sick_days_total: quota.sick_days_total,
            sick_days_used: parseFloat(quota.sick_days_used),
            sick_days_remaining: quota.sick_days_total - parseFloat(quota.sick_days_used)
          } : null
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all tickets (admin view with more data)
   * GET /api/admin/tickets
   */
  static async getAllTickets(req, res, next) {
    try {
      const { status, type, year } = req.query;
      const queryYear = parseInt(year) || new Date().getFullYear();

      let query = `SELECT * FROM tickets WHERE EXTRACT(YEAR FROM created_at) = $1`;
      const values = [queryYear];
      let paramCount = 2;

      if (status) {
        query += ` AND status = $${paramCount}`;
        values.push(status);
        paramCount++;
      }

      if (type) {
        query += ` AND ticket_type = $${paramCount}`;
        values.push(type);
        paramCount++;
      }

      query += ' ORDER BY created_at DESC';

      const result = await pool.query(query, values);

      res.json({
        success: true,
        count: result.rows.length,
        data: result.rows
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminController;
