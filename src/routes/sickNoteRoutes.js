const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const SickNoteController = require('../controllers/sickNoteController');
const { verifyToken } = require('../middleware/auth');
const { attachDbRole, requireDbRole } = require('../middleware/portalAuth');
const { asyncHandler } = require('../middleware/errorHandler');
const { getUploadPath, ensureUploadDirectories } = require('../config/uploadConfig');

// Ensure upload directories exist
ensureUploadDirectories();

// Get upload directory for sick notes
const uploadsDir = getUploadPath('sickNotes');

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `pn-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf', 'image/jpeg', 'image/jpg', 'image/png',
      'image/heic', 'image/heif', 'image/webp', 'image/bmp', 'image/tiff', 'image/tif'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and image files (JPG, PNG, HEIC, WebP, BMP, TIFF) are allowed'), false);
    }
  }
});

// All routes require authentication
router.use(verifyToken);
router.use(attachDbRole);

// Admin routes (must be before /:id to avoid conflicts)
router.get('/all', requireDbRole('admin'), asyncHandler(SickNoteController.getAll));
router.get('/stats/:userId', requireDbRole('admin'), asyncHandler(SickNoteController.getUserStats));

// User routes
router.get('/me', asyncHandler(SickNoteController.getMySickNotes));
router.post('/', upload.single('file'), asyncHandler(SickNoteController.create));
router.get('/stats/me', asyncHandler(async (req, res, next) => {
  req.params.userId = req.user.id;
  return SickNoteController.getUserStats(req, res, next);
}));

// Specific ID routes
router.get('/:id', asyncHandler(SickNoteController.getById));
router.put('/:id', asyncHandler(SickNoteController.update));
router.delete('/:id', asyncHandler(SickNoteController.delete));
router.post('/:id/upload', upload.single('file'), asyncHandler(SickNoteController.uploadFile));
router.get('/:id/file', asyncHandler(SickNoteController.downloadFile));

module.exports = router;
