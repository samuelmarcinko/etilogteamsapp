const Quota = require('../database/models/Quota');
const User = require('../database/models/User');
const Holiday = require('../database/models/Holiday');
const { PamSyncService, PamLookupError } = require('../services/pamSyncService');
const { PamError } = require('../services/pamClient');
const GraphService = require('../services/graphService');
const pool = require('../database/config');
const logger = require('../utils/logger');

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
   * Supports both totals and used values for manual adjustments
   */
  static async updateUserQuota(req, res, next) {
    try {
      const { userId } = req.params;
      const {
        vacation_days_total, vacation_days_used, vacation_days_remaining,
        sick_days_total, sick_days_used,
        paragraph_days_total, paragraph_days_used,
        ocr_days_total, ocr_days_used
      } = req.body;
      const year = parseInt(req.body.year) || new Date().getFullYear();

      // Ensure quota exists first
      await Quota.getOrCreate(userId, year);

      // For vacation: if only remaining is provided, set total = remaining, used = 0
      let vacTotal = vacation_days_total;
      let vacUsed = vacation_days_used;
      if (vacation_days_remaining !== undefined && vacation_days_total === undefined) {
        vacTotal = vacation_days_remaining;
        vacUsed = 0;
      }

      // Use the new full update method if used values are provided
      const hasUsedValues = vacUsed !== undefined ||
                            paragraph_days_used !== undefined ||
                            ocr_days_used !== undefined ||
                            sick_days_used !== undefined;

      let updated;
      if (hasUsedValues) {
        updated = await Quota.updateQuotaFull(userId, year, {
          vacation_days_total: vacTotal,
          vacation_days_used: vacUsed,
          paragraph_days_total,
          paragraph_days_used,
          ocr_days_total,
          ocr_days_used,
          sick_days_total,
          sick_days_used
        });
      } else {
        updated = await Quota.updateTotals(
          userId, year,
          vacTotal,
          sick_days_total,
          paragraph_days_total,
          ocr_days_total
        );
      }

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
        logger.warn('Failed to sync Graph users', { error: e.message });
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

  /**
   * Osobné číslo z PAM a príznak externého pracovníka.
   * PUT /api/quotas/user/:userId/mapping
   *
   * Zámerne samostatný endpoint a nie ďalšie polia v updateUserQuota: toto
   * sa ukladá na používateľa a platí navždy, kým kvóta sa ukladá na rok.
   * Keby to šlo jedným volaním, zmena osobného čísla by sa viazala na rok,
   * v ktorom ju kolegyňa práve prezerala.
   */
  static async updateUserMapping(req, res, next) {
    try {
      const { userId } = req.params;
      const isExternal = Boolean(req.body.is_external);
      const raw = req.body.personal_number;

      // Externému sa osobné číslo nezadáva - model ho aj tak zahodí, ale
      // nemá zmysel kvôli nemu padať na validácii.
      let personalNumber = null;
      if (!isExternal && raw !== undefined && raw !== null && String(raw).trim() !== '') {
        personalNumber = Number.parseInt(String(raw).trim(), 10);
        if (!Number.isInteger(personalNumber) || personalNumber <= 0) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Osobné číslo musí byť celé kladné číslo.'
          });
        }
      }

      const updated = await User.setPamMapping(userId, { personalNumber, isExternal });
      if (!updated) {
        return res.status(404).json({ error: 'Not Found', message: 'Používateľ neexistuje.' });
      }

      logger.info('PAM mapping updated', {
        userId, personalNumber, isExternal, by: req.user?.id
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      // Čiastočný unique index z migrácie 042. Dve osoby s rovnakým osobným
      // číslom by si navzájom prepisovali kvóty a nikto by nevedel, ktorá
      // hodnota komu patrí - preto to databáza odmietne a my to povieme
      // zrozumiteľne namiesto 500.
      if (error.code === '23505') {
        return res.status(409).json({
          error: 'Conflict',
          message: 'Toto osobné číslo už má priradené iný zamestnanec.'
        });
      }
      next(error);
    }
  }

  /**
   * Natiahnuť kvóty jedného človeka z PAM.
   * POST /api/quotas/user/:userId/pam-sync
   *
   * Odpoveď nesie meno, pod ktorým osobné číslo vedie PAM. To je tu to
   * najdôležitejšie: preklep v čísle inak nemá ako vyjsť najavo - kvóty sa
   * natiahnu, budú to platné čísla, len budú patriť niekomu inému.
   */
  static async syncUserFromPam(req, res, next) {
    try {
      const { userId } = req.params;
      const year = parseInt(req.body?.year || req.query.year, 10) || new Date().getFullYear();

      const user = await User.findByUserId(userId);
      if (!user) {
        return res.status(404).json({ error: 'Not Found', message: 'Používateľ neexistuje.' });
      }

      const fromPam = await PamSyncService.shared().syncUser(user, year);
      logger.info('PAM sync (manual)', { userId, year, by: req.user?.id });

      res.json({
        success: true,
        data: {
          pam_name: fromPam.name,
          personal_number: fromPam.personalNumber,
          year: fromPam.year,
          vacation_days_total: fromPam.vacationTotal,
          vacation_days_used: fromPam.vacationUsed,
          vacation_days_remaining: fromPam.vacationTotal - fromPam.vacationUsed,
          paragraph_days_used: fromPam.paragraphUsed,
          ocr_days_used: fromPam.ocrUsed
        }
      });
    } catch (error) {
      // Rozlišujeme dve veci, ktoré sa kolegyni hovoria úplne inak:
      // „toto číslo nesedí" (opraví ho) a „PAM sa neozval" (počká alebo
      // zavolá IT). Jedna spoločná hláška by jej nepomohla ani v jednom.
      if (error instanceof PamLookupError) {
        return res.status(400).json({ error: 'Bad Request', message: error.message, code: error.code });
      }
      if (error instanceof PamError) {
        logger.warn('PAM unreachable during manual sync', { error: error.message });
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'PAM sa neozval. Skontroluj VPN spojenie na ETILOGSAP2.'
        });
      }
      next(error);
    }
  }
}

module.exports = QuotaController;
