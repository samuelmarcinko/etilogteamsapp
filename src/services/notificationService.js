const adapter = require('../bot/botAdapter');
const { ConnectorClient, MicrosoftAppCredentials } = require('botbuilder');
require('dotenv').config();

class NotificationService {
  /**
   * Send notification to user in Teams personal chat
   */
  static async sendNotification(userId, message, actionButton = null) {
    try {
      const botId = process.env.MICROSOFT_APP_ID;
      const botPassword = process.env.MICROSOFT_APP_PASSWORD;
      const tenantId = process.env.TENANT_ID;
      const serviceUrl = 'https://smba.trafficmanager.net/emea/';

      // Create credentials
      const credentials = new MicrosoftAppCredentials(botId, botPassword);
      const connectorClient = new ConnectorClient(credentials, { baseUri: serviceUrl });

      // Create conversation parameters for 1:1 chat
      const conversationParameters = {
        isGroup: false,
        bot: {
          id: `28:${botId}`,
          name: 'ETILOG Approval Bot'
        },
        members: [{
          id: userId
        }],
        tenantId: tenantId,
        activity: null
      };

      // Create conversation with user
      const conversationResponse = await connectorClient.conversations.createConversation(conversationParameters);
      const conversationId = conversationResponse.id;

      // Create message activity
      const activity = {
        type: 'message',
        from: {
          id: `28:${botId}`,
          name: 'ETILOG Approval Bot'
        },
        recipient: {
          id: userId
        },
        conversation: {
          id: conversationId
        },
        text: message,
        attachments: []
      };

      // Add action button if provided (Hero Card)
      if (actionButton) {
        activity.attachments = [{
          contentType: 'application/vnd.microsoft.card.hero',
          content: {
            buttons: [{
              type: 'openUrl',
              title: actionButton.title,
              value: actionButton.url
            }]
          }
        }];
      }

      // Send message
      await connectorClient.conversations.sendToConversation(conversationId, activity);

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
