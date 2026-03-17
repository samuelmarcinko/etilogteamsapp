const express = require('express');
const router = express.Router();
const pool = require('../database/config');

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
    console.error('Working days calculation failed:', e.message);
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
    console.error('Dashboard: quota query failed:', e.message);
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
    console.error('Dashboard: holidays query failed:', e.message);
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
    console.error('Dashboard: ticket stats query failed:', e.message);
  }

  res.json({
    data: {
      quota: quotaData,
      nextHolidays: holidays,
      ticketStats
    }
  });
});

module.exports = router;
