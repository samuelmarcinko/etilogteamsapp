const adapter = require('../bot/botAdapter');
const { TurnContext } = require('botbuilder');
require('dotenv').config();

class NotificationService {
  /**
   * Send notification to user in Teams personal chat
   */
  static async sendNotification(userId, message, actionButton = null) {
    try {
      const botId = process.env.MICROSOFT_APP_ID;
      const tenantId = process.env.TENANT_ID;
      const serviceUrl = 'https://smba.trafficmanager.net/emea/';

      // Create conversation reference for proactive messaging
      const conversationReference = {
        activityId: null,
        user: {
          id: userId,
          name: 'User'
        },
        bot: {
          id: `28:${botId}`,
          name: 'ETILOG Approval Bot'
        },
        conversation: {
          id: userId,
          isGroup: false,
          conversationType: 'personal',
          tenantId: tenantId
        },
        channelId: 'msteams',
        serviceUrl: serviceUrl
      };

      // Use adapter to continue conversation and send proactive message
      await adapter.continueConversationAsync(
        botId,
        conversationReference,
        async (turnContext) => {
          // Create message activity
          const messageActivity = {
            type: 'message',
            text: message
          };

          // Add action button if provided (Hero Card)
          if (actionButton) {
            messageActivity.attachments = [{
              contentType: 'application/vnd.microsoft.card.hero',
              content: {
                text: message,
                buttons: [{
                  type: 'openUrl',
                  title: actionButton.title,
                  value: actionButton.url
                }]
              }
            }];
            // Remove text from activity since it's in the card
            delete messageActivity.text;
          }

          await turnContext.sendActivity(messageActivity);
        }
      );

      return { success: true };
    } catch (error) {
      console.error('Error sending notification:', error);
      // Don't throw - notification failure shouldn't break the main flow
      return { success: false, error: error.message };
    }
  }

  /**
   * Notify approver about new ticket
   */
  static async notifyApproverNewTicket(ticket) {
    try {
      const appUrl = process.env.APP_URL || 'https://teams.etilog.com';
      const deepLink = `https://teams.microsoft.com/l/entity/${process.env.TEAMS_APP_ID}/approvals`;

      const message = `🔔 **New Approval Request**\n\n` +
        `**${ticket.created_by_name}** requested approval for: **${ticket.title}**\n\n` +
        `Type: ${ticket.ticket_type} | Priority: ${ticket.priority}\n\n` +
        `Description: ${ticket.description}`;

      const actionButton = {
        title: 'Open in Approval App',
        url: deepLink
      };

      await this.sendNotification(
        ticket.assigned_approver_id,
        message,
        actionButton
      );

      console.log(`✓ Notification sent to approver: ${ticket.assigned_approver_name}`);
    } catch (error) {
      console.error('Error notifying approver:', error);
    }
  }

  /**
   * Notify creator that ticket was approved
   */
  static async notifyCreatorApproved(ticket, approverName) {
    try {
      const deepLink = `https://teams.microsoft.com/l/entity/${process.env.TEAMS_APP_ID}/myRequests`;

      const message = `✅ **Request Approved**\n\n` +
        `Your request **${ticket.title}** has been approved by **${approverName}**.\n\n` +
        `Ticket ID: ${ticket.ticket_id}`;

      const actionButton = {
        title: 'View My Requests',
        url: deepLink
      };

      await this.sendNotification(
        ticket.created_by_id,
        message,
        actionButton
      );

      console.log(`✓ Approval notification sent to creator: ${ticket.created_by_name}`);
    } catch (error) {
      console.error('Error notifying creator (approved):', error);
    }
  }

  /**
   * Notify creator that ticket was rejected
   */
  static async notifyCreatorRejected(ticket, rejectorName, reason) {
    try {
      const deepLink = `https://teams.microsoft.com/l/entity/${process.env.TEAMS_APP_ID}/myRequests`;

      const message = `❌ **Request Rejected**\n\n` +
        `Your request **${ticket.title}** has been rejected by **${rejectorName}**.\n\n` +
        `Reason: ${reason}\n\n` +
        `Ticket ID: ${ticket.ticket_id}`;

      const actionButton = {
        title: 'View My Requests',
        url: deepLink
      };

      await this.sendNotification(
        ticket.created_by_id,
        message,
        actionButton
      );

      console.log(`✓ Rejection notification sent to creator: ${ticket.created_by_name}`);
    } catch (error) {
      console.error('Error notifying creator (rejected):', error);
    }
  }
}

module.exports = NotificationService;
