/**
 * Centralized Logger Utility
 * - Respects NODE_ENV for log levels
 * - Structured logging format
 * - Easy to extend with external logging services
 */

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const currentLevelNum = LOG_LEVELS[currentLevel] ?? LOG_LEVELS.info;

const formatTimestamp = () => new Date().toISOString();

const formatMessage = (level, message, meta = {}) => {
  const timestamp = formatTimestamp();
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
};

const logger = {
  error: (message, meta = {}) => {
    if (currentLevelNum >= LOG_LEVELS.error) {
      console.error(formatMessage('error', message, meta));
    }
  },

  warn: (message, meta = {}) => {
    if (currentLevelNum >= LOG_LEVELS.warn) {
      console.warn(formatMessage('warn', message, meta));
    }
  },

  info: (message, meta = {}) => {
    if (currentLevelNum >= LOG_LEVELS.info) {
      console.log(formatMessage('info', message, meta));
    }
  },

  debug: (message, meta = {}) => {
    if (currentLevelNum >= LOG_LEVELS.debug) {
      console.log(formatMessage('debug', message, meta));
    }
  },

  // Request logger middleware (optimized - no body logging)
  requestLogger: (req, res, next) => {
    if (currentLevelNum >= LOG_LEVELS.debug) {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.debug(`${req.method} ${req.path}`, {
          status: res.statusCode,
          duration: `${duration}ms`
        });
      });
    }
    next();
  }
};

module.exports = logger;
