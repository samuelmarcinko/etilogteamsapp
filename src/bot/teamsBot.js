const { TeamsActivityHandler, CardFactory, MessageFactory } = require('botbuilder');
const Ticket = require('../database/models/Ticket');
const TicketService = require('../services/ticketService');
const {
  createApprovalCard,
  createApprovedCard,
  createRejectedCard,
  createNotificationCard
} = require('../cards/approvalCard');
const logger = require('../utils/logger');

class TeamsBot extends TeamsActivityHandler {
  constructor() {
    super();

    // Handle messages
    this.onMessage(async (context, next) => {
      const text = context.activity.text?.trim().toLowerCase();

      // Greeting commands
      if (text === 'hello' || text === 'hi' || text === 'hey') {
        await context.sendActivity('Hello! I am the ETILOG Approval Bot 🎫\n\nI help manage approval requests. Type "help" for more information.');
      }
      // Help commands
      else if (text === 'help') {
        await context.sendActivity(this.getHelpMessage());
      }
      // Status command - check pending approvals
      else if (text === 'status') {
        await context.sendActivity('ℹ️ To view the status of your requests, open the app and go to the "My Requests" tab.\n\nTo approve requests, click on the "Approvals" tab.');
      }
      // My requests command
      else if (text === 'my requests' || text === 'requests') {
        await context.sendActivity('📋 You can find your requests in the app under the "My Requests" tab.');
      }
      // Create request command
      else if (text === 'create' || text === 'new request') {
        await context.sendActivity('➕ To create a new request, open the app and go to the "Create Request" tab.');
      }
      // About command
      else if (text === 'about' || text === 'info') {
        await context.sendActivity(this.getAboutMessage());
      }
      // Default response
      else {
        await context.sendActivity('❓ I didn\'t understand that command. Type "help" for a list of available commands.');
      }

      await next();
    });

    // Handle members added
    this.onMembersAdded(async (context, next) => {
      const membersAdded = context.activity.membersAdded;
      for (let member of membersAdded) {
        if (member.id !== context.activity.recipient.id) {
          const welcomeCard = this.getWelcomeCard();
          await context.sendActivity({ attachments: [CardFactory.adaptiveCard(welcomeCard)] });
        }
      }
      await next();
    });

  }

  /**
   * Handle adaptive card invoke actions
   */
  async handleTeamsCardActionInvoke(context) {
    try {
      const invokeValue = context.activity.value;
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
      logger.error('Error handling adaptive card action', { error: error.message });
      return this.createInvokeResponse(500, 'Internal server error');
    }
  }

  /**
   * Handle ticket approval
   */
  async handleApproval(context, ticket, approver) {
    try {
      // Update ticket status and deduct quota days (vacation/sick-leave)
      await TicketService.approveTicket(ticket.ticket_id, approver);

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
      logger.error('Error approving ticket from bot', { error: error.message });
      return this.createInvokeResponse(500, 'Failed to approve ticket');
    }
  }

  /**
   * Handle ticket rejection
   */
  async handleRejection(context, ticket, rejector, rejectionReason) {
    try {
      // Update ticket status via service layer
      await TicketService.rejectTicket(ticket.ticket_id, rejector, rejectionReason);

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
      logger.error('Error rejecting ticket from bot', { error: error.message });
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
      logger.error('Error sending notification to creator', { error: error.message });
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
   * Get welcome card with Dashboard button
   */
  getWelcomeCard() {
    const appId = process.env.TEAMS_APP_ID || '39cb02be-f50d-4e06-afda-ec0ce359e2a8';
    const dashboardDeepLink = `https://teams.microsoft.com/l/entity/${appId}/dashboard`;

    return {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.4',
      body: [
        {
          type: 'TextBlock',
          text: '🎉 Hello! I\'m the ETILOG Approval Bot! 🎫',
          weight: 'Bolder',
          size: 'Large',
          wrap: true
        },
        {
          type: 'TextBlock',
          text: 'I\'m here to help you manage approval requests and speed up the approval process for all ETILOG employees.',
          wrap: true,
          spacing: 'Medium'
        },
        {
          type: 'TextBlock',
          text: '**My main purpose:**',
          weight: 'Bolder',
          wrap: true,
          spacing: 'Medium'
        },
        {
          type: 'TextBlock',
          text: '✅ Accelerate the approval workflow\n✅ Log all requests with complete history tracking\n✅ Send real-time notifications about request status\n📊 Handle time-off, purchases, expenses, and HR requests',
          wrap: true,
          spacing: 'Small'
        },
        {
          type: 'TextBlock',
          text: '**Quick note:** 📦',
          weight: 'Bolder',
          wrap: true,
          spacing: 'Medium'
        },
        {
          type: 'TextBlock',
          text: 'As a bot working for ETILOG - the European technology leader for professional packaging solutions and container systems - I\'m quite busy helping with our innovative packaging needs! That\'s why I can only offer basic command-based assistance (no chatting, sorry! 😅). But don\'t worry, I\'m very efficient at what I do best: managing your approval requests!',
          wrap: true,
          spacing: 'Small'
        },
        {
          type: 'TextBlock',
          text: '**Get started:**',
          weight: 'Bolder',
          wrap: true,
          spacing: 'Medium'
        },
        {
          type: 'TextBlock',
          text: '• Type **"help"** for a list of available commands\n• Click the button below to open the Dashboard',
          wrap: true,
          spacing: 'Small'
        },
        {
          type: 'TextBlock',
          text: 'Have a productive day! 💼',
          wrap: true,
          spacing: 'Medium'
        }
      ],
      actions: [
        {
          type: 'Action.OpenUrl',
          title: '📊 Open Dashboard',
          url: dashboardDeepLink,
          style: 'positive'
        },
        {
          type: 'Action.OpenUrl',
          title: '➕ Create Request',
          url: `https://teams.microsoft.com/l/entity/${appId}/createRequest`
        }
      ]
    };
  }

  /**
   * Get welcome message (text fallback)
   */
  getWelcomeMessage() {
    return `🎉 Hello! I'm the **ETILOG Approval Bot**! 🎫

I'm here to help you manage approval requests and speed up the approval process for all ETILOG employees.

**My main purpose:**
✅ Accelerate the approval workflow
✅ Log all requests with complete history tracking
✅ Send real-time notifications about request status
📊 Handle time-off, purchases, expenses, and HR requests

**Quick note:** 📦
As a bot working for ETILOG - the European technology leader for professional packaging solutions and container systems - I'm quite busy helping with our innovative packaging needs! That's why I can only offer basic command-based assistance (no chatting, sorry! 😅). But don't worry, I'm very efficient at what I do best: managing your approval requests!

**Get started:**
- Type **"help"** for a list of available commands
- Open the app in Teams tab to create a request

Have a productive day! 💼`;
  }

  /**
   * Get help message
   */
  getHelpMessage() {
    return `**📖 ETILOG Approval Bot - Help**

**🙋 For Requesters:**
• Create requests via the app (time-off, purchases, expenses, HR)
• Track the status of your requests
• Receive notifications about approval/rejection

**👨‍💼 For Approvers:**
• Receive requests as Adaptive Cards
• Click "Approve" or "Reject" to process
• Add rejection reason (optional)

**💬 Available Commands:**
• \`hello\` / \`hi\` / \`hey\` - Greet the bot
• \`help\` - Show this help message
• \`status\` - Info about requests
• \`create\` / \`new request\` - How to create a request
• \`my requests\` / \`requests\` - Where to find my requests
• \`about\` / \`info\` - About the application

**🆘 Need help?**
Contact IT department: samuel.marcinko@etilog.com`;
  }

  /**
   * Get about message
   */
  getAboutMessage() {
    return `**ℹ️ About ETILOG Approval Center**

**Version:** 1.0.0
**Developer:** ETILOG IT Team
**Last Update:** January 2026

**Purpose:**
This bot accelerates the approval workflow and maintains complete history tracking for all employee requests. Designed for ETILOG s.r.o. - the European technology leader for professional packaging solutions and container systems.

**Features:**
✅ Time-off and sick leave approvals
✅ Purchase and expense approvals
✅ HR requests
✅ Real-time notifications
✅ Complete request history logging
✅ Pulsing badge notifications

**Technologies:**
• Microsoft Teams Platform
• Node.js + Express
• PostgreSQL Database
• Adaptive Cards

**Support:**
📧 samuel.marcinko@etilog.com
🌐 https://etilog.com

Thank you for using our app! 🎉`;
  }
}

module.exports = TeamsBot;
