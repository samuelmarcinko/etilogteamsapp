const TicketService = require('../services/ticketService');
const NotificationService = require('../services/notificationService');
const TicketAttachment = require('../database/models/TicketAttachment');
const fs = require('fs');
const path = require('path');

class TicketController {
  /**
   * Create a new ticket
   * POST /api/tickets
   */
  static async createTicket(req, res, next) {
    try {
      const { title, description, ticket_type, priority, conversationId, start_date, end_date } = req.body;

      // Validate input
      if (!title || !description) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Title and description are required'
        });
      }

      // Get creator info from authenticated user or request body
      const createdBy = req.user ? {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email
      } : {
        id: req.body.created_by_id || 'unknown',
        name: req.body.created_by_name || 'Unknown User',
        email: req.body.created_by_email || 'unknown@example.com'
      };

      // Parse assigned approver from request body
      const assignedApprover = req.body.assigned_approver_id ? {
        id: req.body.assigned_approver_id,
        name: req.body.assigned_approver_name,
        email: req.body.assigned_approver_email
      } : null;

      // Prepare ticket data
      const ticketData = {
        title,
        description,
        ticketType: ticket_type || 'other',
        priority: priority || 'Medium',
        createdBy,
        assignedApprover,
        conversationId,
        startDate: start_date || null,
        endDate: end_date || null
      };

      // Create ticket
      const ticket = await TicketService.createTicket(ticketData);

      if (req.files && req.files.length) {
        await TicketAttachment.createMany(ticket.ticket_id, req.files, createdBy);
      }

      // Send notification to approver (don't wait for it)
      if (ticket.assigned_approver_id) {
        NotificationService.notifyApproverNewTicket(ticket).catch(err => {
          console.error('Failed to send notification to approver:', err);
        });
      }

      res.status(201).json({
        success: true,
        message: 'Ticket created successfully',
        data: ticket
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all tickets
   * GET /api/tickets
   */
  static async getTickets(req, res, next) {
    try {
      const { status, createdById, assignedApproverId } = req.query;

      const filters = {};
      if (status) filters.status = status;
      if (createdById) filters.createdById = createdById;
      if (assignedApproverId) filters.assignedApproverId = assignedApproverId;

      const tickets = await TicketService.getTickets(filters);

      res.json({
        success: true,
        count: tickets.length,
        data: tickets
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get ticket by ID
   * GET /api/tickets/:ticketId
   */
  static async getTicket(req, res, next) {
    try {
      const { ticketId } = req.params;

      const ticket = await TicketService.getTicket(ticketId);

      res.json({
        success: true,
        data: ticket
      });
    } catch (error) {
      if (error.message === 'Ticket not found') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message
        });
      }
      next(error);
    }
  }

  /**
   * Approve ticket
   * POST /api/tickets/:ticketId/approve
   */
  static async approveTicket(req, res, next) {
    try {
      const { ticketId } = req.params;

      // Get approver info from authenticated user or request body
      const approver = req.user ? {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email
      } : {
        id: req.body.approver_id || 'unknown',
        name: req.body.approver_name || 'Unknown User',
        email: req.body.approver_email || 'unknown@example.com'
      };

      const ticket = await TicketService.approveTicket(ticketId, approver);

      // Send notification to creator (don't wait for it)
      NotificationService.notifyCreatorApproved(ticket, approver.name).catch(err => {
        console.error('Failed to send notification to creator:', err);
      });

      res.json({
        success: true,
        message: 'Ticket approved successfully',
        data: ticket
      });
    } catch (error) {
      if (error.message === 'Ticket not found') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message
        });
      }
      if (error.message === 'Ticket has already been processed') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message
        });
      }
      next(error);
    }
  }

  /**
   * Reject ticket
   * POST /api/tickets/:ticketId/reject
   */
  static async rejectTicket(req, res, next) {
    try {
      const { ticketId } = req.params;
      const { rejectionReason } = req.body;

      // Get rejector info from authenticated user or request body
      const rejector = req.user ? {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email
      } : {
        id: req.body.rejector_id || 'unknown',
        name: req.body.rejector_name || 'Unknown User',
        email: req.body.rejector_email || 'unknown@example.com'
      };

      const ticket = await TicketService.rejectTicket(ticketId, rejector, rejectionReason);

      // Send notification to creator (don't wait for it)
      NotificationService.notifyCreatorRejected(ticket, rejector.name, rejectionReason || 'No reason provided').catch(err => {
        console.error('Failed to send notification to creator:', err);
      });

      res.json({
        success: true,
        message: 'Ticket rejected successfully',
        data: ticket
      });
    } catch (error) {
      if (error.message === 'Ticket not found') {
        return res.status(404).json({
          error: 'Not Found',
          message: error.message
        });
      }
      if (error.message === 'Ticket has already been processed') {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message
        });
      }
      next(error);
    }
  }

  /**
   * Cancel ticket by creator
   * POST /api/tickets/:ticketId/cancel
   */
  static async cancelTicket(req, res, next) {
    try {
      const { ticketId } = req.params;
      const { cancellationReason } = req.body;

      if (!cancellationReason || !cancellationReason.trim()) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Cancellation reason is required'
        });
      }

      // Get canceller info from authenticated user or request body
      const canceller = req.user ? {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email
      } : {
        id: req.body.canceller_id || 'unknown',
        name: req.body.canceller_name || 'Unknown User',
        email: req.body.canceller_email || 'unknown@example.com'
      };

      const result = await TicketService.cancelTicket(ticketId, canceller, cancellationReason.trim());

      // If ticket was approved (quota was deducted), notify the approver via bot
      if (result.wasApproved && result.ticket.assigned_approver_id) {
        NotificationService.notifyApproverCancelled(result.ticket, canceller.name, cancellationReason.trim()).catch(err => {
          console.error('Failed to send cancellation notification to approver:', err);
        });
      }

      res.json({
        success: true,
        message: 'Ticket cancelled successfully',
        data: result.ticket
      });
    } catch (error) {
      if (error.message === 'Ticket not found') {
        return res.status(404).json({ error: 'Not Found', message: error.message });
      }
      if (error.message === 'Only pending or approved tickets can be cancelled' ||
          error.message === 'Only the ticket creator can cancel this request') {
        return res.status(400).json({ error: 'Bad Request', message: error.message });
      }
      next(error);
    }
  }

  /**
   * Get ticket audit log
   * GET /api/tickets/:ticketId/audit
   */
  static async getAuditLog(req, res, next) {
    try {
      const { ticketId } = req.params;

      const auditLog = await TicketService.getTicketAuditLog(ticketId);

      res.json({
        success: true,
        count: auditLog.length,
        data: auditLog
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get my tickets (created by current user)
   * GET /api/tickets/my/tickets
   */
  static async getMyTickets(req, res, next) {
    try {
      const tickets = await TicketService.getTickets({
        createdById: req.user.id
      });

      res.json({
        success: true,
        count: tickets.length,
        data: tickets
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get tickets assigned to me (for approval)
   * GET /api/tickets/assigned/me
   */
  static async getAssignedTickets(req, res, next) {
    try {
      const tickets = await TicketService.getTickets({
        assignedApproverId: req.user.id,
        status: 'Pending'
      });

      res.json({
        success: true,
        count: tickets.length,
        data: tickets
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get approvals performed by current user
   * GET /api/tickets/approvals/me
   */
  static async getMyApprovals(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const tickets = await TicketService.getApprovalsByUser(req.user.id);

      res.json({
        success: true,
        count: tickets.length,
        data: tickets
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List ticket attachments
   * GET /api/tickets/:ticketId/attachments
   */
  static async listAttachments(req, res, next) {
    try {
      const { ticketId } = req.params;
      const attachments = await TicketAttachment.findByTicketId(ticketId);
      res.json({
        success: true,
        count: attachments.length,
        data: attachments
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Download ticket attachment
   * GET /api/tickets/:ticketId/attachments/:attachmentId
   */
  static async downloadAttachment(req, res, next) {
    try {
      const { ticketId, attachmentId } = req.params;
      const attachment = await TicketAttachment.findById(attachmentId);

      if (!attachment || attachment.ticket_id !== ticketId) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Attachment not found'
        });
      }

      if (!fs.existsSync(attachment.file_path)) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'File not found on disk'
        });
      }

      res.setHeader('Content-Type', attachment.file_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.file_name)}"`);
      return res.sendFile(path.resolve(attachment.file_path));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = TicketController;
