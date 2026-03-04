const path = require('path');
const fs = require('fs');

/**
 * Upload configuration for file storage
 *
 * In Docker (production): files are stored in /app/uploads which is mounted to host
 * Host path: /srv/stacks/apps/teams-app/uploads
 *
 * Local development: files are stored in project's uploads directory
 */

// Base upload directory - use environment variable or default
const UPLOAD_BASE_DIR = process.env.UPLOAD_DIR || '/app/uploads';

// Subdirectories for different file types
const UPLOAD_PATHS = {
  sickNotes: path.join(UPLOAD_BASE_DIR, 'sick-notes'),
  ticketAttachments: path.join(UPLOAD_BASE_DIR, 'ticket-attachments'),
  ocr: path.join(UPLOAD_BASE_DIR, 'ocr'),
  documents: path.join(UPLOAD_BASE_DIR, 'documents')
};

/**
 * Ensure all upload directories exist
 */
function ensureUploadDirectories() {
  Object.values(UPLOAD_PATHS).forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created upload directory: ${dir}`);
    }
  });
}

/**
 * Get upload path for a specific type
 * @param {string} type - Type of upload (sickNotes, ticketAttachments, ocr, documents)
 * @returns {string} Full path to upload directory
 */
function getUploadPath(type) {
  if (!UPLOAD_PATHS[type]) {
    throw new Error(`Unknown upload type: ${type}`);
  }
  return UPLOAD_PATHS[type];
}

module.exports = {
  UPLOAD_BASE_DIR,
  UPLOAD_PATHS,
  ensureUploadDirectories,
  getUploadPath
};
