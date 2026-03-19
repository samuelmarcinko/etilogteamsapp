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
   * Get all Azure AD users including those without licenses (diagnostics)
   * GET /api/admin/all-azure-users
   */
  static async getAllAzureUsers(req, res, next) {
    try {
      const allUsers = await GraphService.getAllUsersIncludingUnlicensed();

      // Separate licensed and unlicensed
      const licensed = allUsers.filter(u => u.hasLicense);
      const unlicensed = allUsers.filter(u => !u.hasLicense);

      res.json({
        success: true,
        summary: {
          total: allUsers.length,
          licensed: licensed.length,
          unlicensed: unlicensed.length
        },
        data: allUsers,
        unlicensedUsers: unlicensed
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Diagnose a specific user by email
   * GET /api/admin/diagnose-user?email=xxx
   */
  static async diagnoseUser(req, res, next) {
    try {
      const { email } = req.query;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email parameter is required'
        });
      }

      const diagnosis = await GraphService.diagnoseUser(email);

      res.json({
        success: true,
        data: diagnosis
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

  // ============================================
  // DATA MANAGEMENT (DELETE OPERATIONS)
  // ============================================

  /**
   * Delete all tickets
   * DELETE /api/admin/data/tickets
   */
  static async deleteAllTickets(req, res, next) {
    try {
      // First delete related data
      await pool.query('DELETE FROM ticket_actions');
      await pool.query('DELETE FROM ticket_attachments');
      const result = await pool.query('DELETE FROM tickets RETURNING ticket_id');

      res.json({
        success: true,
        message: `Deleted ${result.rowCount} tickets`,
        count: result.rowCount
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete all sick notes
   * DELETE /api/admin/data/sick-notes
   */
  static async deleteAllSickNotes(req, res, next) {
    try {
      const result = await pool.query('DELETE FROM sick_notes RETURNING id');

      res.json({
        success: true,
        message: `Deleted ${result.rowCount} sick notes`,
        count: result.rowCount
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete all quotas
   * DELETE /api/admin/data/quotas
   */
  static async deleteAllQuotas(req, res, next) {
    try {
      const result = await pool.query('DELETE FROM employee_quotas RETURNING id');

      res.json({
        success: true,
        message: `Deleted ${result.rowCount} quota records`,
        count: result.rowCount
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reset quotas used values to 0 for current year
   * POST /api/admin/data/quotas/reset-used
   */
  static async resetQuotasUsed(req, res, next) {
    try {
      const year = parseInt(req.query.year) || new Date().getFullYear();
      const result = await pool.query(
        `UPDATE employee_quotas
         SET vacation_days_used = 0, sick_days_used = 0,
             paragraph_days_used = 0, ocr_days_used = 0,
             updated_at = CURRENT_TIMESTAMP
         WHERE year = $1
         RETURNING id`,
        [year]
      );

      res.json({
        success: true,
        message: `Reset used values for ${result.rowCount} quota records in year ${year}`,
        count: result.rowCount
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a specific ticket by ID
   * DELETE /api/admin/data/tickets/:ticketId
   */
  static async deleteTicket(req, res, next) {
    try {
      const { ticketId } = req.params;

      // Delete related data first
      await pool.query('DELETE FROM ticket_actions WHERE ticket_id = $1', [ticketId]);
      await pool.query('DELETE FROM ticket_attachments WHERE ticket_id = $1', [ticketId]);
      const result = await pool.query('DELETE FROM tickets WHERE ticket_id = $1 RETURNING *', [ticketId]);

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: 'Ticket not found'
        });
      }

      res.json({
        success: true,
        message: `Deleted ticket ${ticketId}`,
        data: result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a specific sick note by ID
   * DELETE /api/admin/data/sick-notes/:id
   */
  static async deleteSickNote(req, res, next) {
    try {
      const { id } = req.params;
      const result = await pool.query('DELETE FROM sick_notes WHERE id = $1 RETURNING *', [id]);

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: 'Sick note not found'
        });
      }

      res.json({
        success: true,
        message: `Deleted sick note ${id}`,
        data: result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get data statistics for admin system page
   * GET /api/admin/data/stats
   */
  static async getDataStats(req, res, next) {
    try {
      const [tickets, sickNotes, quotas, users, ticketActions, ticketAttachments] = await Promise.all([
        pool.query('SELECT COUNT(*) as count FROM tickets'),
        pool.query('SELECT COUNT(*) as count FROM sick_notes'),
        pool.query('SELECT COUNT(*) as count FROM employee_quotas'),
        pool.query('SELECT COUNT(*) as count FROM users'),
        pool.query('SELECT COUNT(*) as count FROM ticket_actions'),
        pool.query('SELECT COUNT(*) as count FROM ticket_attachments')
      ]);

      res.json({
        success: true,
        data: {
          tickets: parseInt(tickets.rows[0].count),
          sickNotes: parseInt(sickNotes.rows[0].count),
          quotas: parseInt(quotas.rows[0].count),
          users: parseInt(users.rows[0].count),
          ticketActions: parseInt(ticketActions.rows[0].count),
          ticketAttachments: parseInt(ticketAttachments.rows[0].count)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  // ============================================
  // DATABASE BACKUP
  // ============================================

  /**
   * Trigger database backup
   * POST /api/admin/backup
   */
  static async triggerBackup(req, res, next) {
    const { exec } = require('child_process');
    const path = require('path');
    const fs = require('fs');

    try {
      const backupDir = process.env.BACKUP_DIR || '/app/backups';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupFile = path.join(backupDir, `manual-backup-${timestamp}.sql`);

      // Create backup directory if it doesn't exist
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // Get database connection info from environment
      const dbHost = process.env.DB_HOST || 'localhost';
      const dbPort = process.env.DB_PORT || '5432';
      const dbName = process.env.DB_NAME || 'etilog';
      const dbUser = process.env.DB_USER || 'postgres';

      // Build pg_dump command
      const pgDumpCmd = `PGPASSWORD="${process.env.DB_PASSWORD}" pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -F p > "${backupFile}"`;

      exec(pgDumpCmd, { shell: true }, (error, stdout, stderr) => {
        if (error) {
          console.error('Backup error:', error);
          return res.status(500).json({
            success: false,
            message: 'Backup failed: ' + error.message
          });
        }

        // Check if file was created and has content
        if (fs.existsSync(backupFile)) {
          const stats = fs.statSync(backupFile);
          res.json({
            success: true,
            message: 'Backup created successfully',
            data: {
              file: backupFile,
              size: stats.size,
              timestamp: timestamp
            }
          });
        } else {
          res.status(500).json({
            success: false,
            message: 'Backup file was not created'
          });
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List available backups
   * GET /api/admin/backups
   */
  static async listBackups(req, res, next) {
    const fs = require('fs');
    const path = require('path');

    try {
      const backupDir = process.env.BACKUP_DIR || '/app/backups';

      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
        return res.json({
          success: true,
          data: [],
          message: 'Backup directory created, no backups yet'
        });
      }

      const files = fs.readdirSync(backupDir)
        .filter(f => f.endsWith('.sql'))
        .map(f => {
          const filePath = path.join(backupDir, f);
          const stats = fs.statSync(filePath);
          return {
            name: f,
            path: filePath,
            size: stats.size,
            sizeFormatted: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
            created: stats.mtime
          };
        })
        .sort((a, b) => new Date(b.created) - new Date(a.created));

      res.json({
        success: true,
        count: files.length,
        data: files
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminController;
