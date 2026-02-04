const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../database/config');
const { asyncHandler } = require('../middleware/errorHandler');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads/sick-notes');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config for file uploads - extended format support
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
      'application/pdf',
      'image/jpeg', 'image/jpg', 'image/png',
      'image/heic', 'image/heif',
      'image/webp', 'image/bmp',
      'image/tiff', 'image/tif'
    ];
    const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.bmp', '.tiff', '.tif'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Allowed: PDF, JPG, PNG, HEIC, WebP, BMP, TIFF'), false);
    }
  }
});

// GET /api/teams/sick-notes?userId=xxx - get user's sick notes
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.query.userId;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const result = await pool.query(
    `SELECT * FROM sick_notes WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );

  res.json({ data: result.rows });
}));

// POST /api/teams/sick-notes - create sick note with file upload
router.post('/', upload.single('file'), asyncHandler(async (req, res) => {
  const { title, start_date, end_date, doctor_name, diagnosis, user_id, user_name, user_email, document_type } = req.body;

  if (!title || !start_date || !end_date || !user_id) {
    return res.status(400).json({ error: 'Title, start date, end date and user ID are required' });
  }

  const docType = (document_type === 'ocr') ? 'ocr' : 'paragraph';

  // Ensure user exists in users table
  const existingUser = await pool.query('SELECT id FROM users WHERE user_id = $1', [user_id]);
  if (!existingUser.rows[0]) {
    // Create user record if not exists
    await pool.query(
      `INSERT INTO users (user_id, display_name, email) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [user_id, user_name || 'Unknown', user_email || 'unknown@etilog.com']
    );
  }

  const file = req.file;

  const result = await pool.query(
    `INSERT INTO sick_notes (user_id, user_name, user_email, title, start_date, end_date, doctor_name, diagnosis, file_name, file_path, file_type, file_size, status, document_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', $13)
     RETURNING *`,
    [
      user_id,
      user_name || 'Unknown',
      user_email || 'unknown@etilog.com',
      title,
      start_date,
      end_date,
      doctor_name || null,
      diagnosis || null,
      file ? file.originalname : null,
      file ? file.path : null,
      file ? file.mimetype : null,
      file ? file.size : null,
      docType
    ]
  );

  res.status(201).json({ data: result.rows[0] });
}));

module.exports = router;
