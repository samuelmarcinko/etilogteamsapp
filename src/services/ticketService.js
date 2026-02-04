const Ticket = require('../database/models/Ticket');
const CardService = require('./cardService');
const Quota = require('../database/models/Quota');
const Holiday = require('../database/models/Holiday');

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
          const workingDays = await Holiday.countWorkingDays(ticketData.startDate, ticketData.endDate);
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
          console.warn('Quota check failed, allowing ticket creation:', quotaError.message);
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
          console.error('Error sending approval card:', cardError);
          // Continue even if card sending fails
        }
      }

      return ticket;
    } catch (error) {
      console.error('Error creating ticket:', error);
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
      console.error('Error getting ticket:', error);
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
      console.error('Error getting tickets:', error);
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
          const workingDays = await Holiday.countWorkingDays(ticket.start_date, ticket.end_date);
          await Quota.getOrCreate(ticket.created_by_id, year);
          await Quota.addUsedDays(ticket.created_by_id, year, ticket.ticket_type, workingDays);
          console.log(`Deducted ${workingDays} ${ticket.ticket_type} days for user ${ticket.created_by_id}`);
        } catch (quotaError) {
          console.error('Failed to deduct quota days:', quotaError);
        }
      }

      return updatedTicket;
    } catch (error) {
      console.error('Error approving ticket:', error);
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
      console.error('Error rejecting ticket:', error);
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
      console.error('Error getting audit log:', error);
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
      console.error('Error getting approvals by user:', error);
      throw error;
    }
  }
}

module.exports = TicketService;
