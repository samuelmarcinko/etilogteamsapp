const express = require('express');
const router = express.Router();
const pool = require('../database/config');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * Teams-compatible dashboard API routes (no JWT auth)
 * Uses userId from query params (from Teams SDK context)
 */

// GET /api/teams/dashboard?userId=xxx - get user's quota + next holiday + ticket stats
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.query.userId;
  const year = parseInt(req.query.year) || new Date().getFullYear();

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  // Run all queries in parallel
  const [quotaResult, holidaysResult, ticketStatsResult] = await Promise.all([
    // Get user's quota (or default values)
    pool.query(
      `SELECT * FROM quotas WHERE user_id = $1 AND year = $2`,
      [userId, year]
    ),
    // Get upcoming holidays (from today onwards)
    pool.query(
      `SELECT * FROM holidays
       WHERE date >= CURRENT_DATE AND EXTRACT(YEAR FROM date) = $1
       ORDER BY date ASC LIMIT 3`,
      [year]
    ),
    // Get ticket status counts for this user
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'Pending') as pending,
         COUNT(*) FILTER (WHERE status = 'Approved') as approved,
         COUNT(*) FILTER (WHERE status = 'Rejected') as rejected
       FROM tickets
       WHERE created_by_id = $1`,
      [userId]
    )
  ]);

  const quota = quotaResult.rows[0] || null;
  const holidays = holidaysResult.rows;
  const stats = ticketStatsResult.rows[0] || { pending: 0, approved: 0, rejected: 0 };

  // Calculate remaining days
  let quotaData = null;
  if (quota) {
    quotaData = {
      vacation_days_total: quota.vacation_days_total,
      vacation_days_used: parseFloat(quota.vacation_days_used),
      vacation_days_remaining: quota.vacation_days_total - parseFloat(quota.vacation_days_used),
      sick_days_total: quota.sick_days_total,
      sick_days_used: parseFloat(quota.sick_days_used),
      sick_days_remaining: quota.sick_days_total - parseFloat(quota.sick_days_used)
    };
  }

  res.json({
    data: {
      quota: quotaData,
      nextHolidays: holidays,
      ticketStats: {
        pending: parseInt(stats.pending),
        approved: parseInt(stats.approved),
        rejected: parseInt(stats.rejected)
      }
    }
  });
}));

module.exports = router;
