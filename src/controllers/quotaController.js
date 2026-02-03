const Quota = require('../database/models/Quota');
const Holiday = require('../database/models/Holiday');
const GraphService = require('../services/graphService');
const pool = require('../database/config');

class QuotaController {
  /**
   * Get my quota
   * GET /api/quotas/me
   */
  static async getMyQuota(req, res, next) {
    try {
      const year = parseInt(req.query.year) || new Date().getFullYear();
      const quota = await Quota.getOrCreate(req.user.id, year);

      res.json({
        success: true,
        data: {
          ...quota,
          vacation_days_used: parseFloat(quota.vacation_days_used),
          sick_days_used: parseFloat(quota.sick_days_used),
          vacation_days_remaining: quota.vacation_days_total - parseFloat(quota.vacation_days_used),
          sick_days_remaining: quota.sick_days_total - parseFloat(quota.sick_days_used),
          paragraph_days_used: parseFloat(quota.paragraph_days_used || 0),
          paragraph_days_remaining: (quota.paragraph_days_total || 7) - parseFloat(quota.paragraph_days_used || 0),
          ocr_days_used: parseFloat(quota.ocr_days_used || 0),
          ocr_days_remaining: (quota.ocr_days_total || 7) - parseFloat(quota.ocr_days_used || 0)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get quota for a specific user (admin)
   * GET /api/quotas/user/:userId
   */
  static async getUserQuota(req, res, next) {
    try {
      const { userId } = req.params;
      const year = parseInt(req.query.year) || new Date().getFullYear();
      const quota = await Quota.getOrCreate(userId, year);

      res.json({
        success: true,
        data: {
          ...quota,
          vacation_days_used: parseFloat(quota.vacation_days_used),
          sick_days_used: parseFloat(quota.sick_days_used),
          vacation_days_remaining: quota.vacation_days_total - parseFloat(quota.vacation_days_used),
          sick_days_remaining: quota.sick_days_total - parseFloat(quota.sick_days_used),
          paragraph_days_used: parseFloat(quota.paragraph_days_used || 0),
          paragraph_days_remaining: (quota.paragraph_days_total || 7) - parseFloat(quota.paragraph_days_used || 0),
          ocr_days_used: parseFloat(quota.ocr_days_used || 0),
          ocr_days_remaining: (quota.ocr_days_total || 7) - parseFloat(quota.ocr_days_used || 0)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all quotas for a year (admin)
   * GET /api/quotas/all
   */
  static async getAllQuotas(req, res, next) {
    try {
      const year = parseInt(req.query.year) || new Date().getFullYear();
      const quotas = await Quota.findAllByYear(year);

      res.json({
        success: true,
        count: quotas.length,
        data: quotas.map(q => ({
          ...q,
          vacation_days_used: parseFloat(q.vacation_days_used),
          sick_days_used: parseFloat(q.sick_days_used),
          vacation_days_remaining: q.vacation_days_total - parseFloat(q.vacation_days_used),
          sick_days_remaining: q.sick_days_total - parseFloat(q.sick_days_used),
          paragraph_days_used: parseFloat(q.paragraph_days_used || 0),
          paragraph_days_remaining: (q.paragraph_days_total || 7) - parseFloat(q.paragraph_days_used || 0),
          ocr_days_used: parseFloat(q.ocr_days_used || 0),
          ocr_days_remaining: (q.ocr_days_total || 7) - parseFloat(q.ocr_days_used || 0)
        }))
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update user quota (admin)
   * PUT /api/quotas/user/:userId
   */
  static async updateUserQuota(req, res, next) {
    try {
      const { userId } = req.params;
      const { vacation_days_total, sick_days_total, paragraph_days_total, ocr_days_total } = req.body;
      const year = parseInt(req.body.year) || new Date().getFullYear();

      // Ensure quota exists first
      await Quota.getOrCreate(userId, year);

      const updated = await Quota.updateTotals(
        userId, year,
        vacation_days_total,
        sick_days_total,
        paragraph_days_total,
        ocr_days_total
      );

      res.json({
        success: true,
        message: 'Quota updated',
        data: updated
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get/update quota settings (admin)
   * GET /api/quotas/settings
   */
  static async getSettings(req, res, next) {
    try {
      const settings = await Quota.getAllSettings();
      res.json({ success: true, data: settings });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update quota settings (admin)
   * PUT /api/quotas/settings
   */
  static async updateSettings(req, res, next) {
    try {
      const { year, default_vacation_days, default_sick_days, carry_over_enabled, max_carry_over_days, default_paragraph_days, default_ocr_days } = req.body;

      if (!year) {
        return res.status(400).json({ error: 'Bad Request', message: 'Year is required' });
      }

      const settings = await Quota.upsertSettings(
        year,
        default_vacation_days || 20,
        default_sick_days || 5,
        carry_over_enabled || false,
        max_carry_over_days || 0,
        default_paragraph_days || 7,
        default_ocr_days || 7
      );

      res.json({
        success: true,
        message: 'Settings updated',
        data: settings
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Initialize quotas for all users (admin)
   * POST /api/quotas/initialize
   *
   * 1. Syncs all Entra ID (Graph API) users into users table
   * 2. Creates quotas for users who don't have one yet
   */
  static async initializeQuotas(req, res, next) {
    try {
      const year = parseInt(req.body.year) || new Date().getFullYear();

      // Step 1: Sync all Graph API users into the users table
      let syncedCount = 0;
      try {
        const graphUsers = await GraphService.getUsers();
        for (const gu of graphUsers) {
          await pool.query(
            `INSERT INTO users (user_id, display_name, email)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id) DO UPDATE SET
               display_name = EXCLUDED.display_name,
               email = EXCLUDED.email`,
            [gu.id, gu.name, gu.email]
          );
          syncedCount++;
        }
      } catch (e) {
        console.error('Failed to sync Graph users:', e.message);
      }

      // Step 2: Initialize quotas for all users in DB
      const created = await Quota.initializeForAllUsers(year);

      res.json({
        success: true,
        message: `Synced ${syncedCount} users, initialized quotas for ${created.length} new users`,
        count: created.length,
        synced: syncedCount,
        data: created
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check quota availability
   * POST /api/quotas/check
   */
  static async checkAvailability(req, res, next) {
    try {
      const { user_id, type, start_date, end_date } = req.body;
      const userId = user_id || req.user.id;

      if (!type || !start_date || !end_date) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'type, start_date and end_date are required'
        });
      }

      const year = new Date(start_date).getFullYear();
      const workingDays = await Holiday.countWorkingDays(start_date, end_date);
      const hasEnough = await Quota.hasEnoughDays(userId, year, type, workingDays);
      const quota = await Quota.getOrCreate(userId, year);

      const column = type === 'vacation' ? 'vacation' : 'sick';
      const total = quota[`${column}_days_total`];
      const used = parseFloat(quota[`${column}_days_used`]);

      res.json({
        success: true,
        data: {
          available: hasEnough,
          requested_days: workingDays,
          total_days: total,
          used_days: used,
          remaining_days: total - used,
          type
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get holidays
   * GET /api/quotas/holidays
   */
  static async getHolidays(req, res, next) {
    try {
      const year = parseInt(req.query.year) || new Date().getFullYear();
      const holidays = await Holiday.findByYear(year);

      res.json({
        success: true,
        count: holidays.length,
        data: holidays
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Count working days between dates
   * GET /api/quotas/working-days
   */
  static async countWorkingDays(req, res, next) {
    try {
      const { start_date, end_date } = req.query;
      if (!start_date || !end_date) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'start_date and end_date are required'
        });
      }

      const workingDays = await Holiday.countWorkingDays(start_date, end_date);

      res.json({
        success: true,
        data: { start_date, end_date, working_days: workingDays }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = QuotaController;
