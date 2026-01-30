const express = require('express');
const router = express.Router();
const ticketRoutes = require('./ticketRoutes');
const userRoutes = require('./userRoutes');
const adminRoutes = require('./adminRoutes');
const quotaRoutes = require('./quotaRoutes');
const sickNoteRoutes = require('./sickNoteRoutes');

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Teams Approval App'
  });
});

// API routes
router.use('/tickets', ticketRoutes);
router.use('/users', userRoutes);
router.use('/admin', adminRoutes);
router.use('/quotas', quotaRoutes);
router.use('/sick-notes', sickNoteRoutes);

module.exports = router;
