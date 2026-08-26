const pool = require('../database/config');
const User = require('../database/models/User');
const Quota = require('../database/models/Quota');
const Ticket = require('../database/models/Ticket');
const GraphService = require('../services/graphService');
const { getUserPermissions } = require('../middleware/portalAuth');

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

      if (!['admin', 'spravca', 'user', 'sklad', 'sklad_read'].includes(role)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Role must be "admin", "spravca", "user", "sklad" or "sklad_read"'
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

      // Resolved from the role/permission matrix. Sent alongside role so the
      // portal can switch off the hardcoded hasModuleAccess() rules without a
      // second request; nothing reads it yet.
      const permissions = await getUserPermissions(dbUser.role);

      res.json({
        success: true,
        data: {
          id: req.user.id,
          email: req.user.email,
          name: req.user.name,
          role: dbUser.role,
          permissions,
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

  /**
   * Admin update a ticket
   * PUT /api/admin/tickets/:ticketId
   */
  static async updateTicket(req, res, next) {
    try {
      const { ticketId } = req.params;
      const body = req.body || {};

      const fields = {};
      const allowed = [
        'title', 'description', 'ticket_type', 'priority', 'status',
        'start_date', 'end_date', 'is_half_day',
        'rejection_reason', 'cancellation_reason'
      ];

      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
          let val = body[key];
          if (key === 'start_date' || key === 'end_date') {
            val = val || null;
          }
          if (key === 'is_half_day') {
            val = !!val;
          }
          fields[key] = val;
        }
      }

      // Validate status
      if (fields.status && !['Pending', 'Approved', 'Rejected', 'Cancelled'].includes(fields.status)) {
        return res.status(400).json({ success: false, message: 'Invalid status' });
      }

      const existing = await Ticket.findById(ticketId);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Ticket not found' });
      }

      const performedBy = {
        id: req.user?.id || 'admin',
        name: req.user?.name || 'Admin',
        email: req.user?.email || ''
      };

      const updated = await Ticket.adminUpdate(ticketId, fields, performedBy);

      res.json({
        success: true,
        message: 'Ticket updated',
        data: updated
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
   * Bulk delete tickets by IDs
   * POST /api/admin/data/tickets/bulk-delete
   */
  static async bulkDeleteTickets(req, res, next) {
    try {
      const { ticketIds } = req.body;

      if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No ticket IDs provided'
        });
      }

      // Delete related data first
      await pool.query('DELETE FROM ticket_actions WHERE ticket_id = ANY($1)', [ticketIds]);
      await pool.query('DELETE FROM ticket_attachments WHERE ticket_id = ANY($1)', [ticketIds]);
      const result = await pool.query('DELETE FROM tickets WHERE ticket_id = ANY($1) RETURNING ticket_id', [ticketIds]);

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
   * Bulk delete sick notes by IDs
   * POST /api/admin/data/sick-notes/bulk-delete
   */
  static async bulkDeleteSickNotes(req, res, next) {
    try {
      const { sickNoteIds } = req.body;

      if (!sickNoteIds || !Array.isArray(sickNoteIds) || sickNoteIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No sick note IDs provided'
        });
      }

      const result = await pool.query('DELETE FROM sick_notes WHERE id = ANY($1) RETURNING id', [sickNoteIds]);

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

      // Build pg_dump command (use -f flag instead of shell redirection to avoid empty file on error)
      const pgDumpCmd = `PGPASSWORD="${process.env.DB_PASSWORD}" pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -F p -f "${backupFile}"`;

      exec(pgDumpCmd, { shell: true }, (error, stdout, stderr) => {
        if (error) {
          console.error('Backup error:', error);
          // Clean up empty file if it was created
          if (fs.existsSync(backupFile)) {
            try { fs.unlinkSync(backupFile); } catch (e) { /* ignore */ }
          }
          return res.status(500).json({
            success: false,
            message: 'Backup failed: ' + error.message
          });
        }

        // Check if file was created and has content
        if (fs.existsSync(backupFile)) {
          const stats = fs.statSync(backupFile);
          if (stats.size === 0) {
            // Empty file means something went wrong
            try { fs.unlinkSync(backupFile); } catch (e) { /* ignore */ }
            return res.status(500).json({
              success: false,
              message: 'Backup failed: File is empty (pg_dump may have failed)'
            });
          }
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

  // ============================================
  // EXPORT FUNCTIONALITY
  // ============================================

  /**
   * Export tickets to XLSX or PDF
   * GET /api/admin/export/tickets
   */
  static async exportTickets(req, res, next) {
    try {
      const { type, employee, dateFrom, dateTo, statuses, format, lang } = req.query;

      if (!dateFrom || !dateTo) {
        return res.status(400).json({
          success: false,
          message: 'Date range is required'
        });
      }

      const statusArray = statuses ? statuses.split(',') : ['Approved'];

      // Build query
      let query = `
        SELECT * FROM tickets
        WHERE 1=1
      `;
      const values = [];
      let paramCount = 1;

      // Filter by type
      if (type) {
        query += ` AND ticket_type = $${paramCount}`;
        values.push(type);
        paramCount++;
      }

      // Filter by employee
      if (employee) {
        query += ` AND created_by = $${paramCount}`;
        values.push(employee);
        paramCount++;
      }

      // Filter by date range - use range overlap for tickets with start_date/end_date
      // Range overlap: ticket overlaps filter if start_date <= dateTo AND end_date >= dateFrom
      query += ` AND (
        (start_date IS NOT NULL AND start_date <= $${paramCount + 1} AND COALESCE(end_date, start_date) >= $${paramCount})
        OR (start_date IS NULL AND created_at >= $${paramCount} AND created_at <= $${paramCount + 1})
      )`;
      values.push(dateFrom, dateTo);
      paramCount += 2;

      // Filter by statuses
      if (statusArray.length > 0) {
        query += ` AND status = ANY($${paramCount})`;
        values.push(statusArray);
        paramCount++;
      }

      query += ' ORDER BY start_date ASC NULLS LAST, created_at ASC';

      const result = await pool.query(query, values);
      const tickets = result.rows;

      if (tickets.length === 0) {
        return res.status(404).json({
          success: false,
          message: lang === 'sk' ? 'Žiadne dáta na export' : 'No data to export'
        });
      }

      // Translations
      const translations = {
        sk: {
          title: 'Export tiketov',
          subtitle: 'Prehľad dovoleniek a tiketov',
          dateRange: 'Obdobie',
          ticketId: 'ID tiketu',
          employee: 'Zamestnanec',
          email: 'Email',
          type: 'Typ',
          status: 'Stav',
          dateFrom: 'Dátum od',
          dateTo: 'Dátum do',
          days: 'Dni',
          createdAt: 'Vytvorené',
          approver: 'Schvaľovateľ',
          Approved: 'Schválené',
          Pending: 'Čakajúce',
          Rejected: 'Zamietnuté',
          vacation: 'Dovolenka',
          'sick-leave': 'PN',
          paragraph: 'Paragraf',
          ocr: 'OČR',
          purchase: 'Nákup',
          expense: 'Výdavok',
          hr: 'HR',
          other: 'Iné',
          total: 'Celkom',
          generatedAt: 'Vygenerované'
        },
        en: {
          title: 'Tickets Export',
          subtitle: 'Vacation and tickets overview',
          dateRange: 'Period',
          ticketId: 'Ticket ID',
          employee: 'Employee',
          email: 'Email',
          type: 'Type',
          status: 'Status',
          dateFrom: 'Date from',
          dateTo: 'Date to',
          days: 'Days',
          createdAt: 'Created',
          approver: 'Approver',
          Approved: 'Approved',
          Pending: 'Pending',
          Rejected: 'Rejected',
          vacation: 'Vacation',
          'sick-leave': 'Sick Leave',
          paragraph: 'Paragraph',
          ocr: 'FMC',
          purchase: 'Purchase',
          expense: 'Expense',
          hr: 'HR',
          other: 'Other',
          total: 'Total',
          generatedAt: 'Generated'
        }
      };

      const t = translations[lang] || translations.sk;

      // Helper function to calculate days
      const calculateDays = (ticket) => {
        if (!ticket.start_date) return '-';
        const start = new Date(ticket.start_date);
        const end = ticket.end_date ? new Date(ticket.end_date) : start;
        // Calculate difference in days (+1 because both days are inclusive)
        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        // If it's a half day (single day with is_half_day flag), return 0.5
        if (ticket.is_half_day && diffDays === 1) {
          return '0,5';
        }
        return String(diffDays);
      };

      if (format === 'xlsx') {
        // Generate XLSX
        const XLSX = require('xlsx');

        const data = tickets.map(ticket => ({
          [t.ticketId]: ticket.ticket_id,
          [t.employee]: ticket.created_by_name,
          [t.email]: ticket.created_by_email,
          [t.type]: t[ticket.ticket_type] || ticket.ticket_type,
          [t.status]: t[ticket.status] || ticket.status,
          [t.dateFrom]: ticket.start_date ? new Date(ticket.start_date).toLocaleDateString(lang === 'sk' ? 'sk-SK' : 'en-GB') : '-',
          [t.dateTo]: ticket.end_date ? new Date(ticket.end_date).toLocaleDateString(lang === 'sk' ? 'sk-SK' : 'en-GB') : '-',
          [t.days]: calculateDays(ticket),
          [t.approver]: ticket.assigned_approver_name || '-',
          [t.createdAt]: new Date(ticket.created_at).toLocaleDateString(lang === 'sk' ? 'sk-SK' : 'en-GB')
        }));

        const ws = XLSX.utils.json_to_sheet(data);

        // Set column widths
        ws['!cols'] = [
          { wch: 12 }, // Ticket ID
          { wch: 25 }, // Employee
          { wch: 30 }, // Email
          { wch: 12 }, // Type
          { wch: 12 }, // Status
          { wch: 12 }, // Date from
          { wch: 12 }, // Date to
          { wch: 8 },  // Days
          { wch: 25 }, // Approver
          { wch: 12 }  // Created
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, t.title);

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const filename = `export_${type || 'tickets'}_${dateFrom}_${dateTo}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);

      } else if (format === 'pdf') {
        // Generate PDF
        const PDFDocument = require('pdfkit');
        const path = require('path');

        const doc = new PDFDocument({
          margin: 40,
          size: 'A4',
          layout: 'landscape'
        });

        // Register font with diacritics support
        const fontPath = path.join(__dirname, '../../public/fonts/dejavu-sans.ttf');
        doc.registerFont('DejaVu', fontPath);
        doc.font('DejaVu');

        const filename = `export_${type || 'tickets'}_${dateFrom}_${dateTo}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        doc.pipe(res);

        // Header
        doc.fontSize(18).fillColor('#D9000C').text(t.title, { align: 'center' });
        doc.fontSize(12).fillColor('#666666').text(t.subtitle, { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#333333').text(`${t.dateRange}: ${dateFrom} - ${dateTo}`, { align: 'center' });
        doc.moveDown();

        // Table header
        const tableTop = doc.y;
        const colWidths = [70, 120, 70, 70, 70, 70, 40, 120, 70];
        const headers = [t.ticketId, t.employee, t.type, t.status, t.dateFrom, t.dateTo, t.days, t.approver, t.createdAt];
        let x = 40;

        doc.fontSize(8).fillColor('#ffffff');
        doc.rect(40, tableTop - 5, 760, 18).fill('#D9000C');

        headers.forEach((header, i) => {
          doc.fillColor('#ffffff').text(header, x, tableTop, { width: colWidths[i], align: 'left' });
          x += colWidths[i] + 5;
        });

        // Table rows
        let y = tableTop + 20;
        doc.fontSize(7).fillColor('#333333');

        tickets.forEach((ticket, idx) => {
          if (y > 530) {
            doc.addPage();
            y = 40;
          }

          // Alternate row colors
          if (idx % 2 === 0) {
            doc.rect(40, y - 3, 760, 14).fill('#f8f8f8');
          }

          x = 40;
          const row = [
            ticket.ticket_id,
            ticket.created_by_name || '-',
            t[ticket.ticket_type] || ticket.ticket_type,
            t[ticket.status] || ticket.status,
            ticket.start_date ? new Date(ticket.start_date).toLocaleDateString(lang === 'sk' ? 'sk-SK' : 'en-GB') : '-',
            ticket.end_date ? new Date(ticket.end_date).toLocaleDateString(lang === 'sk' ? 'sk-SK' : 'en-GB') : '-',
            calculateDays(ticket),
            ticket.assigned_approver_name || '-',
            new Date(ticket.created_at).toLocaleDateString(lang === 'sk' ? 'sk-SK' : 'en-GB')
          ];

          doc.fillColor('#333333');
          row.forEach((cell, i) => {
            doc.text(cell, x, y, { width: colWidths[i], align: 'left' });
            x += colWidths[i] + 5;
          });

          y += 14;
        });

        // Footer
        doc.moveDown(2);
        doc.fontSize(9).fillColor('#666666');
        doc.text(`${t.total}: ${tickets.length}`, 40, y + 20);
        doc.text(`${t.generatedAt}: ${new Date().toLocaleString(lang === 'sk' ? 'sk-SK' : 'en-GB')}`, 40, y + 35);

        doc.end();

      } else {
        return res.status(400).json({
          success: false,
          message: 'Invalid format. Use xlsx or pdf.'
        });
      }

    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminController;
