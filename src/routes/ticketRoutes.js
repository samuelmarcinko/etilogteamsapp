const express = require('express');
const router = express.Router();
const TicketController = require('../controllers/ticketController');
const { optionalAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// Optional auth for development - will be changed to verifyToken in production
router.use(optionalAuth);

// Create ticket
router.post('/', asyncHandler(TicketController.createTicket));

// Get my tickets
router.get('/my/tickets', asyncHandler(TicketController.getMyTickets));

// Get assigned tickets
router.get('/assigned/me', asyncHandler(TicketController.getAssignedTickets));

// Get all tickets (with filters)
router.get('/', asyncHandler(TicketController.getTickets));

// Get ticket by ID
router.get('/:ticketId', asyncHandler(TicketController.getTicket));

// Approve ticket
router.post('/:ticketId/approve', asyncHandler(TicketController.approveTicket));

// Reject ticket
router.post('/:ticketId/reject', asyncHandler(TicketController.rejectTicket));

// Get audit log
router.get('/:ticketId/audit', asyncHandler(TicketController.getAuditLog));

module.exports = router;
