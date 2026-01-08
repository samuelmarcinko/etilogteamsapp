const { TeamsActivityHandler, CardFactory, MessageFactory } = require('botbuilder');
const Ticket = require('../database/models/Ticket');
const {
  createApprovalCard,
  createApprovedCard,
  createRejectedCard,
  createNotificationCard
} = require('../cards/approvalCard');

class TeamsBot extends TeamsActivityHandler {
  constructor() {
    super();

    // Handle messages
    this.onMessage(async (context, next) => {
      const text = context.activity.text?.trim().toLowerCase();

      if (text === 'hello' || text === 'hi') {
        await context.sendActivity('Hello! I am the Approval Bot. I help manage approval requests.');
      } else if (text === 'help') {
        await context.sendActivity(this.getHelpMessage());
      } else {
        await context.sendActivity('I didn\'t understand that. Type "help" for available commands.');
      }

      await next();
    });

    // Handle members added
    this.onMembersAdded(async (context, next) => {
      const membersAdded = context.activity.membersAdded;
      for (let member of membersAdded) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity(this.getWelcomeMessage());
        }
      }
      await next();
    });

    // Handle adaptive card actions
    this.onAdaptiveCardInvoke(async (context, invokeValue) => {
      try {
        const action = invokeValue.action?.verb;
        const data = invokeValue.action?.data;

        if (!action || !data?.ticketId) {
          return this.createInvokeResponse(400, 'Invalid action data');
        }

        const ticket = await Ticket.findById(data.ticketId);
        if (!ticket) {
          return this.createInvokeResponse(404, 'Ticket not found');
        }

        if (ticket.status !== 'Pending') {
          return this.createInvokeResponse(400, 'Ticket has already been processed');
        }

        // Get user information
        const user = {
          id: context.activity.from.aadObjectId || context.activity.from.id,
          name: context.activity.from.name,
          email: context.activity.from.email || context.activity.from.userPrincipalName
        };

        // Verify user is the assigned approver
        if (ticket.assigned_approver_id && ticket.assigned_approver_id !== user.id) {
          return this.createInvokeResponse(403, 'You are not authorized to approve this ticket');
        }

        if (action === 'approve') {
          return await this.handleApproval(context, ticket, user);
        } else if (action === 'reject') {
          const rejectionReason = data.rejectionReason || invokeValue.action?.data?.inputs?.rejectionReason;
          return await this.handleRejection(context, ticket, user, rejectionReason);
        }

        return this.createInvokeResponse(400, 'Unknown action');
      } catch (error) {
        console.error('Error handling adaptive card action:', error);
        return this.createInvokeResponse(500, 'Internal server error');
      }
    });
  }

  /**
   * Handle ticket approval
   */
  async handleApproval(context, ticket, approver) {
    try {
      // Update ticket status
      await Ticket.updateStatus(ticket.ticket_id, 'Approved', approver);

      // Update the card to show approved status
      const approvedCard = createApprovedCard(ticket, approver);
      await context.updateActivity({
        ...context.activity,
        attachments: [CardFactory.adaptiveCard(approvedCard)]
      });

      // Send notification to ticket creator
      await this.sendNotificationToCreator(context, ticket, 'Approved', approver);

      return this.createInvokeResponse(200, 'Ticket approved successfully');
    } catch (error) {
      console.error('Error approving ticket:', error);
      return this.createInvokeResponse(500, 'Failed to approve ticket');
    }
  }

  /**
   * Handle ticket rejection
   */
  async handleRejection(context, ticket, rejector, rejectionReason) {
    try {
      // Update ticket status
      await Ticket.updateStatus(ticket.ticket_id, 'Rejected', rejector, rejectionReason);

      // Update the card to show rejected status
      const rejectedCard = createRejectedCard(ticket, rejector, rejectionReason);
      await context.updateActivity({
        ...context.activity,
        attachments: [CardFactory.adaptiveCard(rejectedCard)]
      });

      // Send notification to ticket creator
      await this.sendNotificationToCreator(context, ticket, 'Rejected', rejector, rejectionReason);

      return this.createInvokeResponse(200, 'Ticket rejected successfully');
    } catch (error) {
      console.error('Error rejecting ticket:', error);
      return this.createInvokeResponse(500, 'Failed to reject ticket');
    }
  }

  /**
   * Send notification to ticket creator
   */
  async sendNotificationToCreator(context, ticket, status, actionBy, rejectionReason = null) {
    try {
      // Create notification card
      const notificationCard = createNotificationCard(ticket, status, actionBy, rejectionReason);

      // Create conversation reference for the ticket creator
      const conversationParameters = {
        isGroup: false,
        bot: context.activity.recipient,
        members: [{ id: ticket.created_by_id }],
        tenantId: context.activity.conversation.tenantId
      };

      await context.adapter.createConversation(
        context.activity.channelId,
        context.activity.serviceUrl,
        context.adapter.credentials.appId,
        conversationParameters,
        async (turnContext) => {
          await turnContext.sendActivity({
            attachments: [CardFactory.adaptiveCard(notificationCard)]
          });
        }
      );
    } catch (error) {
      console.error('Error sending notification to creator:', error);
    }
  }

  /**
   * Create invoke response
   */
  createInvokeResponse(statusCode, message) {
    return {
      status: statusCode,
      body: {
        statusCode: statusCode,
        type: 'application/vnd.microsoft.card.adaptive',
        value: message
      }
    };
  }

  /**
   * Get welcome message
   */
  getWelcomeMessage() {
    return `Welcome to the Approval Bot! 🎫

I help manage approval requests for HR and Accounting teams.

**What I can do:**
- Send approval requests to managers
- Process approvals and rejections
- Send notifications about ticket status

Type "help" for more information.`;
  }

  /**
   * Get help message
   */
  getHelpMessage() {
    return `**Approval Bot Help** 📖

**For HR/Accounting Staff:**
- Create tickets through the API or web interface
- Receive notifications when tickets are approved/rejected

**For Managers:**
- Receive approval requests as Adaptive Cards
- Click "Approve" or "Reject" to process tickets
- Optionally add rejection reasons

**Commands:**
- \`hello\` - Say hello to the bot
- \`help\` - Show this help message

For more information, contact your IT administrator.`;
  }
}

module.exports = TeamsBot;
