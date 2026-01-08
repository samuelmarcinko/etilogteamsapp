const Ticket = require('../database/models/Ticket');
const CardService = require('./cardService');

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

      // Create ticket in database
      const ticket = await Ticket.create(ticketData);

      // Send approval card to manager
      if (ticketData.assignedApprover?.id) {
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
}

module.exports = TicketService;
