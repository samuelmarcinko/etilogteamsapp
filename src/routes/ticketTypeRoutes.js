const express = require('express');
const router = express.Router();
const pool = require('../database/config');
const { verifyToken } = require('../middleware/auth');
const { attachDbRole, requireDbRole } = require('../middleware/portalAuth');
const { asyncHandler } = require('../middleware/errorHandler');

// Public route - get active ticket types (used by Teams app, no auth needed)
router.get('/active', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT id, key, label_sk, label_en, requires_dates, sort_order FROM ticket_types WHERE is_active = TRUE ORDER BY sort_order ASC, id ASC'
  );
  res.json({ data: result.rows });
}));

// Admin routes - require JWT auth
router.get('/', verifyToken, attachDbRole, requireDbRole('admin'), asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM ticket_types ORDER BY sort_order ASC, id ASC'
  );
  res.json({ data: result.rows });
}));

router.post('/', verifyToken, attachDbRole, requireDbRole('admin'), asyncHandler(async (req, res) => {
  const { key, label_sk, label_en, requires_dates, sort_order } = req.body;

  if (!key || !label_sk || !label_en) {
    return res.status(400).json({ error: 'key, label_sk and label_en are required' });
  }

  // Sanitize key: lowercase, replace spaces with dashes
  const sanitizedKey = key.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const result = await pool.query(
    `INSERT INTO ticket_types (key, label_sk, label_en, requires_dates, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [sanitizedKey, label_sk, label_en, requires_dates || false, sort_order || 0]
  );

  res.status(201).json({ data: result.rows[0] });
}));

router.put('/:id', verifyToken, attachDbRole, requireDbRole('admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { label_sk, label_en, requires_dates, is_active, sort_order } = req.body;

  const result = await pool.query(
    `UPDATE ticket_types
     SET label_sk = COALESCE($1, label_sk),
         label_en = COALESCE($2, label_en),
         requires_dates = COALESCE($3, requires_dates),
         is_active = COALESCE($4, is_active),
         sort_order = COALESCE($5, sort_order),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $6
     RETURNING *`,
    [label_sk, label_en, requires_dates, is_active, sort_order, id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Ticket type not found' });
  }

  res.json({ data: result.rows[0] });
}));

router.delete('/:id', verifyToken, attachDbRole, requireDbRole('admin'), asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if type is used by any tickets
  const typeResult = await pool.query('SELECT key FROM ticket_types WHERE id = $1', [id]);
  if (!typeResult.rows[0]) {
    return res.status(404).json({ error: 'Ticket type not found' });
  }

  const usageResult = await pool.query(
    'SELECT COUNT(*) as count FROM tickets WHERE ticket_type = $1',
    [typeResult.rows[0].key]
  );

  if (parseInt(usageResult.rows[0].count) > 0) {
    return res.status(400).json({
      error: `Cannot delete - this type is used by ${usageResult.rows[0].count} tickets. Deactivate it instead.`
    });
  }

  await pool.query('DELETE FROM ticket_types WHERE id = $1', [id]);
  res.json({ message: 'Ticket type deleted' });
}));

module.exports = router;
