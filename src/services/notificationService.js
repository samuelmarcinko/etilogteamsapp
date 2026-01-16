const axios = require('axios');
require('dotenv').config();

class NotificationService {
  /**
   * Get Graph API access token
   */
  static async getGraphToken() {
    const tokenEndpoint = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
    const params = new URLSearchParams();
    params.append('client_id', process.env.MICROSOFT_APP_ID);
    params.append('client_secret', process.env.MICROSOFT_APP_PASSWORD);
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('grant_type', 'client_credentials');

    const response = await axios.post(tokenEndpoint, params);
    return response.data.access_token;
  }

  /**
   * Send Activity Feed notification to user
   */
  static async sendNotification(userId, title, message, deepLink) {
    try {
      const accessToken = await this.getGraphToken();
      const teamsAppId = process.env.TEAMS_APP_ID;

      // Create activity feed notification
      const notification = {
        topic: {
          source: 'entityUrl',
          value: `https://graph.microsoft.com/v1.0/users/${userId}`
        },
        activityType: 'approvalRequest',
        previewText: {
          content: title
        },
        templateParameters: [
          {
            name: 'approvalTitle',
            value: title
          },
          {
            name: 'approvalMessage',
            value: message
          }
        ],
        teamsAppId: teamsAppId
      };

      // Add deep link if provided
      if (deepLink) {
        notification.webUrl = deepLink;
      }

      // Send notification via Graph API
      await axios.post(
        `https://graph.microsoft.com/v1.0/users/${userId}/teamwork/sendActivityNotification`,
        notification,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return { success: true };
    } catch (error) {
      console.error('Error sending notification:', error.response?.data || error.message);
      // Don't throw - notification failure shouldn't break the main flow
      return { success: false, error: error.message };
    }
  }

  /**
   * Notify approver about new ticket
   */
  static async notifyApproverNewTicket(ticket) {
    try {
      const deepLink = `https://teams.microsoft.com/l/entity/${process.env.TEAMS_APP_ID}/approvals`;

      const title = `New approval request: ${ticket.title}`;
      const message = `${ticket.created_by_name} requested approval for ${ticket.title} (${ticket.ticket_type}, Priority: ${ticket.priority})`;

      await this.sendNotification(
        ticket.assigned_approver_id,
        title,
        message,
        deepLink
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

      const title = `Request approved: ${ticket.title}`;
      const message = `Your request "${ticket.title}" has been approved by ${approverName}`;

      await this.sendNotification(
        ticket.created_by_id,
        title,
        message,
        deepLink
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

      const title = `Request rejected: ${ticket.title}`;
      const message = `Your request "${ticket.title}" has been rejected by ${rejectorName}. Reason: ${reason}`;

      await this.sendNotification(
        ticket.created_by_id,
        title,
        message,
        deepLink
      );

      console.log(`✓ Rejection notification sent to creator: ${ticket.created_by_name}`);
    } catch (error) {
      console.error('Error notifying creator (rejected):', error);
    }
  }
}

module.exports = NotificationService;
