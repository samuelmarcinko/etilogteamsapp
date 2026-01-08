const express = require('express');
const router = express.Router();
const ticketRoutes = require('./ticketRoutes');

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

module.exports = router;
