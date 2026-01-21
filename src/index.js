const express = require('express');
const path = require('path');
require('dotenv').config();

const adapter = require('./bot/botAdapter');
const TeamsBot = require('./bot/teamsBot');
const apiRoutes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const ReminderService = require('./services/reminderService');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3978;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));
app.use('/assets', express.static(path.join(__dirname, '../public/assets')));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Create bot instance
const bot = new TeamsBot();

// Initialize reminder service
const reminderService = new ReminderService();
reminderService.start();

// Bot Framework endpoint
app.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, (context) => bot.run(context));
});

// API routes
app.use('/api', apiRoutes);

// Manual reminder trigger endpoint (for testing)
app.post('/api/reminders/trigger', async (req, res) => {
  try {
    console.log('🔄 Manual reminder trigger requested');
    await reminderService.triggerManualCheck();
    res.json({
      success: true,
      message: 'Reminder check triggered successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error triggering reminder:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger reminder check',
      error: error.message
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handlers (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎫 Teams Approval App                                   ║
║                                                           ║
║   Server running on port ${PORT}                           ║
║   Environment: ${process.env.NODE_ENV || 'development'}                              ║
║                                                           ║
║   Endpoints:                                              ║
║   - Bot Messages:  POST /api/messages                     ║
║   - API:          /api/*                                  ║
║   - Health Check: GET /api/health                         ║
║   - Web UI:       GET /                                   ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  reminderService.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down gracefully...');
  reminderService.stop();
  process.exit(0);
});

module.exports = app;
