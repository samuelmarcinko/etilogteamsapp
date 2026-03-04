const express = require('express');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

const adapter = require('./bot/botAdapter');
const TeamsBot = require('./bot/teamsBot');
const apiRoutes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const ReminderService = require('./services/reminderService');
const logger = require('./utils/logger');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3978;

// Compression middleware (before static files - reduces payload 2-5x)
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file cache configuration
// TEMPORARILY DISABLED - set to true when app is in final state
const ENABLE_CACHE = false;

const staticOptions = {
  maxAge: ENABLE_CACHE ? '1d' : 0,
  etag: ENABLE_CACHE,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (!ENABLE_CACHE) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    } else if (filePath.match(/\.(js|css)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else if (filePath.match(/\.(png|jpg|jpeg|gif|ico|svg|woff|woff2)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  }
};

// Serve static files from public directory with caching
app.use(express.static(path.join(__dirname, '../public'), staticOptions));
app.use('/assets', express.static(path.join(__dirname, '../public/assets'), staticOptions));

// Serve portal static files
app.use('/portal', express.static(path.join(__dirname, '../public/portal'), staticOptions));

// Serve uploaded files (no cache - dynamic content)
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), { maxAge: 0 }));

// Request logging (only in debug mode)
app.use(logger.requestLogger);

// Create bot instance
const bot = new TeamsBot();

// Initialize reminder service
const reminderService = new ReminderService();
reminderService.start();

// Bot Framework endpoint
app.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, (context) => bot.run(context));
});

// Auth config endpoint (public - no auth needed)
app.get('/api/auth/config', (req, res) => {
  res.json({
    clientId: process.env.CLIENT_ID || process.env.MICROSOFT_APP_ID,
    tenantId: process.env.TENANT_ID,
    redirectUri: (process.env.APP_BASE_URL || 'https://portal.etilog.com') + '/portal/'
  });
});

// API routes
app.use('/api', apiRoutes);

// Manual reminder trigger endpoint (for testing)
app.post('/api/reminders/trigger', async (req, res) => {
  try {
    logger.info('Manual reminder trigger requested');
    await reminderService.triggerManualCheck();
    res.json({
      success: true,
      message: 'Reminder check triggered successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error triggering reminder', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to trigger reminder check',
      error: error.message
    });
  }
});

// Health check endpoint (for Docker/Traefik healthchecks)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Portal login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/portal/login.html'));
});

// Portal SPA routes - serve the portal shell for all /portal/* paths
app.get('/portal/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/portal/index.html'));
});

// Error handlers (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Teams Approval App started`, {
    port: PORT,
    env: process.env.NODE_ENV || 'development',
    compression: 'enabled',
    caching: ENABLE_CACHE ? 'enabled' : 'disabled'
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down gracefully (SIGINT)');
  reminderService.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down gracefully (SIGTERM)');
  reminderService.stop();
  process.exit(0);
});

module.exports = app;
