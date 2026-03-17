const Ticket = require('../database/models/Ticket');
const CardService = require('./cardService');
const Quota = require('../database/models/Quota');
const Holiday = require('../database/models/Holiday');
const logger = require('../utils/logger');

class TicketService {
  /**
   * Create a new ticket and send approval card
   */
  static async createTicket(ticketData) {
    try {
      // Validate required fields
      if (!ticketData.title || !ticketData.description) {
        throw new Error('Title and description are required');
      }

      if (!ticketData.createdBy || !ticketData.createdBy.id) {
        throw new Error('Creator information is required');
      }

      // Quota check for types that require dates and have quotas
      const quotaTypes = ['vacation', 'sick-leave', 'paragraph', 'ocr'];
      if (quotaTypes.includes(ticketData.ticketType) &&
          ticketData.startDate && ticketData.endDate) {
        try {
          const year = new Date(ticketData.startDate).getFullYear();
          let workingDays = await Holiday.countWorkingDays(ticketData.startDate, ticketData.endDate);
          // If half-day is requested and it's a single day, use 0.5 instead of 1
          if (ticketData.isHalfDay && ticketData.startDate === ticketData.endDate) {
            workingDays = 0.5;
          }
          const hasEnough = await Quota.hasEnoughDays(
            ticketData.createdBy.id, year, ticketData.ticketType, workingDays
          );

          if (!hasEnough) {
            const quota = await Quota.getOrCreate(ticketData.createdBy.id, year);
            const typeLabels = {
              'vacation': 'dovolenky',
              'sick-leave': 'PN',
              'paragraph': 'Paragraf',
              'ocr': 'OČR'
            };
            const colPrefixes = {
              'vacation': 'vacation',
              'sick-leave': 'sick',
              'paragraph': 'paragraph',
              'ocr': 'ocr'
            };
            const label = typeLabels[ticketData.ticketType] || ticketData.ticketType;
            const col = colPrefixes[ticketData.ticketType] || 'sick';
            const remaining = quota[`${col}_days_total`] - parseFloat(quota[`${col}_days_used`]);
            throw new Error(
              `Nedostatok dni ${label}. Pozadovane: ${workingDays} pracovnych dni, zostatok: ${remaining} dni.`
            );
          }
        } catch (quotaError) {
          // Re-throw quota errors, but don't block on DB errors
          if (quotaError.message.includes('Nedostatok')) {
            throw quotaError;
          }
          logger.warn('Quota check failed, allowing ticket creation', { error: quotaError.message });
        }
      }

      // Create ticket in database
      const ticket = await Ticket.create(ticketData);

      // Send approval card to manager - DISABLED
      // Using NotificationService instead (called from ticketController.js)
      if (false && ticketData.assignedApprover?.id) {
        try {
          const cardResult = await CardService.sendApprovalCard(
            ticket,
            ticketData.assignedApprover.id,
            ticketData.conversationId
          );

          // Update ticket with conversation info
          if (cardResult.activityId) {
            await Ticket.updateConversationInfo(
              ticket.ticket_id,
              cardResult.conversationReference?.conversation?.id,
              cardResult.activityId
            );
          }
        } catch (cardError) {
          logger.error('Error sending approval card', { error: cardError.message });
          // Continue even if card sending fails
        }
      }

      return ticket;
    } catch (error) {
      logger.error('Error creating ticket', { error: error.message });
      throw error;
    }
  }

  /**
   * Get ticket by ID
   */
  static async getTicket(ticketId) {
    try {
      const ticket = await Ticket.findById(ticketId);
      if (!ticket) {
        throw new Error('Ticket not found');
      }
      return ticket;
    } catch (error) {
      logger.error('Error getting ticket', { error: error.message });
      throw error;
    }
  }

  /**
   * Get all tickets with optional filters
   */
  static async getTickets(filters = {}) {
    try {
      return await Ticket.findAll(filters);
    } catch (error) {
      logger.error('Error getting tickets', { error: error.message });
      throw error;
    }
  }

  /**
   * Approve ticket
   */
  static async approveTicket(ticketId, approver) {
    try {
      const ticket = await Ticket.findById(ticketId);
      if (!ticket) {
        throw new Error('Ticket not found');
      }

      if (ticket.status !== 'Pending') {
        throw new Error('Ticket has already been processed');
      }

      // Update ticket status
      const updatedTicket = await Ticket.updateStatus(ticketId, 'Approved', approver);

      // Deduct quota days for types with quotas (vacation, sick-leave, paragraph, ocr)
      const quotaTypes = ['vacation', 'sick-leave', 'paragraph', 'ocr'];
      if (quotaTypes.includes(ticket.ticket_type) &&
          ticket.start_date && ticket.end_date) {
        try {
          const year = new Date(ticket.start_date).getFullYear();
          let workingDays = await Holiday.countWorkingDays(ticket.start_date, ticket.end_date);
          // If half-day is requested and it's a single day, use 0.5 instead of 1
          const startStr = new Date(ticket.start_date).toISOString().split('T')[0];
          const endStr = new Date(ticket.end_date).toISOString().split('T')[0];
          if (ticket.is_half_day && startStr === endStr) {
            workingDays = 0.5;
          }
          await Quota.getOrCreate(ticket.created_by_id, year);
          await Quota.addUsedDays(ticket.created_by_id, year, ticket.ticket_type, workingDays);
          logger.debug('Quota deducted', { days: workingDays, type: ticket.ticket_type, userId: ticket.created_by_id, isHalfDay: ticket.is_half_day });
        } catch (quotaError) {
          logger.error('Failed to deduct quota days', { error: quotaError.message });
        }
      }

      return updatedTicket;
    } catch (error) {
      logger.error('Error approving ticket', { error: error.message });
      throw error;
    }
  }

  /**
   * Reject ticket
   */
  static async rejectTicket(ticketId, rejector, rejectionReason = null) {
    try {
      const ticket = await Ticket.findById(ticketId);
      if (!ticket) {
        throw new Error('Ticket not found');
      }

      if (ticket.status !== 'Pending') {
        throw new Error('Ticket has already been processed');
      }

      // Update ticket status
      const updatedTicket = await Ticket.updateStatus(
        ticketId,
        'Rejected',
        rejector,
        rejectionReason
      );

      return updatedTicket;
    } catch (error) {
      logger.error('Error rejecting ticket', { error: error.message });
      throw error;
    }
  }

  /**
   * Cancel ticket by creator
   */
  static async cancelTicket(ticketId, canceller, cancellationReason) {
    try {
      const ticket = await Ticket.findById(ticketId);
      if (!ticket) {
        throw new Error('Ticket not found');
      }

      // Only Pending or Approved tickets can be cancelled
      if (ticket.status !== 'Pending' && ticket.status !== 'Approved') {
        throw new Error('Only pending or approved tickets can be cancelled');
      }

      // Only the creator can cancel their own ticket
      if (ticket.created_by_id !== canceller.id) {
        throw new Error('Only the ticket creator can cancel this request');
      }

      const wasApproved = ticket.status === 'Approved';

      // Update ticket status to Cancelled
      const updatedTicket = await Ticket.updateStatus(
        ticketId,
        'Cancelled',
        canceller,
        cancellationReason
      );

      // If ticket was approved and has quota types, return the days
      const quotaTypes = ['vacation', 'sick-leave', 'paragraph', 'ocr'];
      if (wasApproved && quotaTypes.includes(ticket.ticket_type) &&
          ticket.start_date && ticket.end_date) {
        try {
          const year = new Date(ticket.start_date).getFullYear();
          let workingDays = await Holiday.countWorkingDays(ticket.start_date, ticket.end_date);
          // If half-day was requested and it's a single day, return 0.5 instead of 1
          const startStr = new Date(ticket.start_date).toISOString().split('T')[0];
          const endStr = new Date(ticket.end_date).toISOString().split('T')[0];
          if (ticket.is_half_day && startStr === endStr) {
            workingDays = 0.5;
          }
          await Quota.removeUsedDays(ticket.created_by_id, year, ticket.ticket_type, workingDays);
          logger.debug('Quota returned', { days: workingDays, type: ticket.ticket_type, userId: ticket.created_by_id, isHalfDay: ticket.is_half_day });
        } catch (quotaError) {
          logger.error('Failed to return quota days', { error: quotaError.message });
        }
      }

      return { ticket: updatedTicket, wasApproved };
    } catch (error) {
      logger.error('Error cancelling ticket', { error: error.message });
      throw error;
    }
  }

  /**
   * Get ticket audit log
   */
  static async getTicketAuditLog(ticketId) {
    try {
      const actions = await Ticket.getActions(ticketId);
      return actions;
    } catch (error) {
      logger.error('Error getting audit log', { error: error.message });
      throw error;
    }
  }

  /**
   * Get approvals performed by a user
   */
  static async getApprovalsByUser(userId) {
    try {
      return await Ticket.findApprovalsByUserId(userId);
    } catch (error) {
      logger.error('Error getting approvals by user', { error: error.message });
      throw error;
    }
  }
}

module.exports = TicketService;
