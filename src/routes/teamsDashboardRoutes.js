const express = require('express');
const router = express.Router();
const pool = require('../database/config');
const logger = require('../utils/logger');

/**
 * Teams-compatible dashboard API routes (no JWT auth)
 * Uses userId from query params (from Teams SDK context)
 */

// GET /api/teams/working-days?startDate=xxx&endDate=yyy
// Calculate working days between two dates (excludes weekends and holidays)
router.get('/working-days', async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  try {
    const result = await pool.query(
      `SELECT COUNT(*) as working_days
       FROM generate_series($1::date, $2::date, '1 day') d
       WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
         AND d NOT IN (SELECT date FROM holidays WHERE date >= $1 AND date <= $2)`,
      [startDate, endDate]
    );
    const workingDays = parseInt(result.rows[0].working_days) || 0;
    res.json({ data: { workingDays } });
  } catch (e) {
    logger.error('Working days calculation failed', { error: e.message });
    res.status(500).json({ error: 'Failed to calculate working days' });
  }
});

// GET /api/teams/dashboard?userId=xxx
router.get('/', async (req, res) => {
  const userId = req.query.userId;
  const year = parseInt(req.query.year) || new Date().getFullYear();

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  // Each query is wrapped individually so one failure doesn't break all
  let quotaData = null;
  let holidays = [];
  let ticketStats = { pending: 0, approved: 0, rejected: 0 };

  // 1. Get user's quota
  try {
    const result = await pool.query(
      'SELECT * FROM employee_quotas WHERE user_id = $1 AND year = $2',
      [userId, year]
    );
    const quota = result.rows[0];
    if (quota) {
      quotaData = {
        vacation_days_total: quota.vacation_days_total,
        vacation_days_used: parseFloat(quota.vacation_days_used),
        vacation_days_remaining: quota.vacation_days_total - parseFloat(quota.vacation_days_used),
        sick_days_total: quota.sick_days_total,
        sick_days_used: parseFloat(quota.sick_days_used),
        sick_days_remaining: quota.sick_days_total - parseFloat(quota.sick_days_used),
        paragraph_days_total: quota.paragraph_days_total || 7,
        paragraph_days_used: parseFloat(quota.paragraph_days_used || 0),
        paragraph_days_remaining: (quota.paragraph_days_total || 7) - parseFloat(quota.paragraph_days_used || 0),
        ocr_days_total: quota.ocr_days_total || 7,
        ocr_days_used: parseFloat(quota.ocr_days_used || 0),
        ocr_days_remaining: (quota.ocr_days_total || 7) - parseFloat(quota.ocr_days_used || 0)
      };
    }
  } catch (e) {
    logger.warn('Dashboard: quota query failed', { error: e.message, userId });
  }

  // 2. Get upcoming holidays
  try {
    const result = await pool.query(
      `SELECT * FROM holidays
       WHERE date >= CURRENT_DATE AND EXTRACT(YEAR FROM date) = $1
       ORDER BY date ASC LIMIT 3`,
      [year]
    );
    holidays = result.rows;
  } catch (e) {
    logger.warn('Dashboard: holidays query failed', { error: e.message });
  }

  // 3. Get ticket stats
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'Pending') as pending,
         COUNT(*) FILTER (WHERE status = 'Approved') as approved,
         COUNT(*) FILTER (WHERE status = 'Rejected') as rejected
       FROM tickets
       WHERE created_by_id = $1`,
      [userId]
    );
    const row = result.rows[0];
    if (row) {
      ticketStats = {
        pending: parseInt(row.pending) || 0,
        approved: parseInt(row.approved) || 0,
        rejected: parseInt(row.rejected) || 0
      };
    }
  } catch (e) {
    logger.warn('Dashboard: ticket stats query failed', { error: e.message, userId });
  }

  res.json({
    data: {
      quota: quotaData,
      nextHolidays: holidays,
      ticketStats
    }
  });
});

// GET /api/teams/out-of-office?date=YYYY-MM-DD
// Get employees who are out of office on a specific date
router.get('/out-of-office', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  logger.debug('Out of office request', { date });

  try {
    // Get approved tickets for vacation, sick-leave, paragraph, and ocr
    // where the date falls between start_date and end_date
    // Using LOWER() for case-insensitive comparison and explicit DATE cast
    const result = await pool.query(
      `SELECT
         t.ticket_id,
         t.ticket_type,
         t.start_date,
         t.end_date,
         t.created_by_name,
         t.created_by_id,
         t.title,
         t.status
       FROM tickets t
       WHERE t.status = 'Approved'
         AND LOWER(t.ticket_type) IN ('vacation', 'sick-leave', 'paragraph', 'ocr')
         AND t.start_date::date <= $1::date
         AND t.end_date::date >= $1::date
       ORDER BY t.created_by_name ASC`,
      [date]
    );

    logger.debug('Out of office query result', {
      date,
      count: result.rows.length,
      tickets: result.rows.map(r => ({ id: r.ticket_id, type: r.ticket_type, start: r.start_date, end: r.end_date, name: r.created_by_name }))
    });

    // Group by user (in case someone has multiple overlapping absences)
    const userMap = new Map();
    result.rows.forEach(row => {
      if (!userMap.has(row.created_by_id)) {
        userMap.set(row.created_by_id, {
          userId: row.created_by_id,
          name: row.created_by_name,
          absences: []
        });
      }
      userMap.get(row.created_by_id).absences.push({
        ticketId: row.ticket_id,
        type: row.ticket_type?.toLowerCase() || row.ticket_type,
        startDate: row.start_date,
        endDate: row.end_date,
        title: row.title
      });
    });

    res.json({
      data: {
        date,
        employees: Array.from(userMap.values())
      }
    });
  } catch (e) {
    logger.error('Out of office query failed', { error: e.message, date });
    res.status(500).json({ error: 'Failed to get out of office data' });
  }
});

// DEBUG: Get all approved tickets with dates for debugging
router.get('/debug-tickets', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         ticket_id,
         ticket_type,
         LOWER(ticket_type) as ticket_type_lower,
         start_date,
         end_date,
         created_by_name,
         status,
         CURRENT_DATE as today
       FROM tickets
       WHERE status = 'Approved'
         AND start_date IS NOT NULL
         AND end_date IS NOT NULL
       ORDER BY start_date DESC
       LIMIT 20`
    );
    res.json({ data: result.rows, today: new Date().toISOString().split('T')[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
