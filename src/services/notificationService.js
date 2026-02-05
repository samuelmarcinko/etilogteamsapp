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
          source: 'text',
          value: 'Approval Request'
        },
        activityType: 'approvalRequired',
        previewText: {
          content: title
        },
        templateParameters: [
          {
            name: 'approvalTaskId',
            value: title
          }
        ],
        teamsAppId: teamsAppId
      };

      // Add deep link if provided
      if (deepLink) {
        notification.topic.webUrl = deepLink;
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
  /**
   * Notify approver that a previously approved ticket was cancelled by the creator
   * Sends a proactive Bot message (AdaptiveCard) to the approver's chat
   */
  static async notifyApproverCancelled(ticket, cancellerName, reason) {
    try {
      // 1. Send Activity Feed notification
      const deepLink = `https://teams.microsoft.com/l/entity/${process.env.TEAMS_APP_ID}/approvals`;
      const title = `Request cancelled: ${ticket.title}`;
      const message = `${cancellerName} cancelled an approved request "${ticket.title}". Reason: ${reason}`;

      await this.sendNotification(
        ticket.assigned_approver_id,
        title,
        message,
        deepLink
      );

      // 2. Send proactive Bot message with AdaptiveCard
      await this.sendCancellationBotMessage(ticket, cancellerName, reason);

      console.log(`✓ Cancellation notification sent to approver: ${ticket.assigned_approver_name}`);
    } catch (error) {
      console.error('Error notifying approver (cancelled):', error);
    }
  }

  /**
   * Send proactive Bot Framework message to approver about cancellation
   */
  static async sendCancellationBotMessage(ticket, cancellerName, reason) {
    try {
      const axios = require('axios');

      // Get Bot Framework token
      const tokenEndpoint = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', process.env.MICROSOFT_APP_ID);
      params.append('client_secret', process.env.MICROSOFT_APP_PASSWORD);
      params.append('scope', 'https://api.botframework.com/.default');

      const tokenResponse = await axios.post(tokenEndpoint, params);
      const token = tokenResponse.data.access_token;

      // Build AdaptiveCard
      const card = {
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'Container',
            style: 'attention',
            items: [
              { type: 'TextBlock', text: '🚫 Request Cancelled', weight: 'Bolder', size: 'Large', color: 'Attention' },
              { type: 'TextBlock', text: `${cancellerName} has cancelled a previously approved request.`, wrap: true }
            ]
          },
          {
            type: 'FactSet',
            facts: [
              { title: 'Request:', value: ticket.title },
              { title: 'Ticket ID:', value: ticket.ticket_id },
              { title: 'Type:', value: ticket.ticket_type },
              { title: 'Cancelled by:', value: cancellerName },
              ...(ticket.start_date && ticket.end_date ? [{ title: 'Dates:', value: `${ticket.start_date} → ${ticket.end_date}` }] : [])
            ]
          },
          {
            type: 'Container',
            style: 'warning',
            items: [
              { type: 'TextBlock', text: '**Reason for cancellation:**', wrap: true },
              { type: 'TextBlock', text: reason, wrap: true }
            ]
          },
          {
            type: 'TextBlock',
            text: 'Quota days have been returned to the employee.',
            size: 'Small',
            isSubtle: true,
            wrap: true,
            spacing: 'Medium'
          }
        ]
      };

      // Create conversation with approver
      const serviceUrl = 'https://smba.trafficmanager.net/emea/';
      const conversationParams = {
        bot: { id: process.env.MICROSOFT_APP_ID, name: 'ETILOG Approval Bot' },
        isGroup: false,
        members: [{ id: ticket.assigned_approver_id }],
        tenantId: process.env.TENANT_ID,
        channelData: { tenant: { id: process.env.TENANT_ID } }
      };

      const conversationResponse = await axios.post(
        `${serviceUrl}v3/conversations`,
        conversationParams,
        { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );

      const conversationId = conversationResponse.data.id;

      // Send the message
      await axios.post(
        `${serviceUrl}v3/conversations/${conversationId}/activities`,
        {
          type: 'message',
          from: { id: process.env.MICROSOFT_APP_ID, name: 'ETILOG Approval Bot' },
          conversation: { id: conversationId },
          attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }]
        },
        { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Error sending cancellation bot message:', error.response?.data || error.message);
    }
  }
}

module.exports = NotificationService;
