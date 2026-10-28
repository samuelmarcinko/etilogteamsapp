const express = require('express');
const router = express.Router();
const pool = require('../database/config');
const Quota = require('../database/models/Quota');
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
  //
  // Cez model, nie priamym SELECT-om: zostatok dnes závisí od toho, či je
  // človek napojený na PAM. Keby si to táto obrazovka počítala po svojom,
  // ukazovala by iné číslo než portál, a nikto by nevedel ktoré platí.
  try {
    quotaData = await Quota.effective(userId, year);
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

  try {
    // Get approved tickets for vacation, sick-leave, paragraph, and ocr
    // where the date falls between start_date and end_date
    const result = await pool.query(
      `SELECT
         t.ticket_id,
         t.ticket_type,
         t.start_date,
         t.end_date,
         t.created_by_name,
         t.created_by_id,
         t.title,
         t.is_half_day
       FROM tickets t
       WHERE t.status = 'Approved'
         AND LOWER(t.ticket_type) IN ('vacation', 'sick-leave', 'paragraph', 'ocr')
         AND t.start_date::date <= $1::date
         AND t.end_date::date >= $1::date
       ORDER BY t.created_by_name ASC`,
      [date]
    );

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
      // Polovičný deň platí len na jednodňovej žiadosti - presne tak, ako to
      // ráta ticketService pri odpočte kvóty. Keby sa príznak bral aj na
      // viacdňovej, kalendár by tvrdil „pol dňa" o týždni dovolenky, ktorý
      // sa z kvóty odpočítal celý.
      const oneDay = row.start_date && row.end_date
        && new Date(row.start_date).toDateString() === new Date(row.end_date).toDateString();

      userMap.get(row.created_by_id).absences.push({
        ticketId: row.ticket_id,
        type: row.ticket_type?.toLowerCase() || row.ticket_type,
        startDate: row.start_date,
        endDate: row.end_date,
        title: row.title,
        halfDay: Boolean(row.is_half_day) && oneDay
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

module.exports = router;
