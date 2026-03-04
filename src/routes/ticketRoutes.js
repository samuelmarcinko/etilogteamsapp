const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const TicketController = require('../controllers/ticketController');
const { optionalAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { getUploadPath, ensureUploadDirectories } = require('../config/uploadConfig');

// Ensure upload directories exist
ensureUploadDirectories();

// Get upload directory for ticket attachments
const uploadsDir = getUploadPath('ticketAttachments');

// Multer config for ticket attachments
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `ticket-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB per file
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, JPG, PNG, DOCX, XLSX files are allowed'), false);
    }
  }
});

const maybeUploadAttachments = (req, res, next) => {
  if (req.is('multipart/form-data')) {
    return upload.array('attachments', 10)(req, res, next);
  }
  return next();
};

// Optional auth for development - will be changed to verifyToken in production
router.use(optionalAuth);

// Create ticket
router.post('/', maybeUploadAttachments, asyncHandler(TicketController.createTicket));

// Get my tickets
router.get('/my/tickets', asyncHandler(TicketController.getMyTickets));

// Get assigned tickets
router.get('/assigned/me', asyncHandler(TicketController.getAssignedTickets));

// Get approvals performed by me
router.get('/approvals/me', asyncHandler(TicketController.getMyApprovals));

// Get all tickets (with filters)
router.get('/', asyncHandler(TicketController.getTickets));

// Get ticket by ID
router.get('/:ticketId', asyncHandler(TicketController.getTicket));

// Ticket attachments
router.get('/:ticketId/attachments', asyncHandler(TicketController.listAttachments));
router.get('/:ticketId/attachments/:attachmentId', asyncHandler(TicketController.downloadAttachment));

// Approve ticket
router.post('/:ticketId/approve', asyncHandler(TicketController.approveTicket));

// Reject ticket
router.post('/:ticketId/reject', asyncHandler(TicketController.rejectTicket));

// Cancel ticket (by creator)
router.post('/:ticketId/cancel', asyncHandler(TicketController.cancelTicket));

// Get audit log
router.get('/:ticketId/audit', asyncHandler(TicketController.getAuditLog));

module.exports = router;
