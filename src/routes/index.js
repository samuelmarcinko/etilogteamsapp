const express = require('express');
const router = express.Router();
const ticketRoutes = require('./ticketRoutes');
const userRoutes = require('./userRoutes');

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

module.exports = router;
