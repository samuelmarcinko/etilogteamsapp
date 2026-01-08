const TicketService = require('../services/ticketService');

class TicketController {
  /**
   * Create a new ticket
   * POST /api/tickets
   */
  static async createTicket(req, res, next) {
    try {
      const { title, description, ticketType, priority, assignedApprover, conversationId } = req.body;

      // Validate input
      if (!title || !description) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Title and description are required'
        });
      }

      // Get creator info from authenticated user
      const createdBy = {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email
      };

      // Prepare ticket data
      const ticketData = {
        title,
        description,
        ticketType: ticketType || 'Other',
        priority: priority || 'Medium',
        createdBy,
        assignedApprover,
        conversationId
      };

      // Create ticket
      const ticket = await TicketService.createTicket(ticketData);

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

      const approver = {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email
      };

      const ticket = await TicketService.approveTicket(ticketId, approver);

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

      const rejector = {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email
      };

      const ticket = await TicketService.rejectTicket(ticketId, rejector, rejectionReason);

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
}

module.exports = TicketController;
