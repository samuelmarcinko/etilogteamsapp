const axios = require('axios');
require('dotenv').config();
const logger = require('../utils/logger');

// Token cache for reducing auth requests
const tokenCache = {
  graph: { token: null, expiresAt: 0 },
  bot: { token: null, expiresAt: 0 }
};

// Axios instance with timeout for faster failure detection
const httpClient = axios.create({ timeout: 10000 });

class NotificationService {
  /**
   * Get Graph API access token (with caching)
   */
  static async getGraphToken() {
    const now = Date.now();
    if (tokenCache.graph.token && tokenCache.graph.expiresAt > now + 60000) {
      return tokenCache.graph.token;
    }

    const tokenEndpoint = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
    const params = new URLSearchParams();
    params.append('client_id', process.env.MICROSOFT_APP_ID);
    params.append('client_secret', process.env.MICROSOFT_APP_PASSWORD);
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('grant_type', 'client_credentials');

    const response = await httpClient.post(tokenEndpoint, params);
    const { access_token, expires_in } = response.data;

    tokenCache.graph = {
      token: access_token,
      expiresAt: now + (expires_in * 1000)
    };

    return access_token;
  }

  /**
   * Get Bot Framework token (with caching)
   */
  static async getBotToken() {
    const now = Date.now();
    if (tokenCache.bot.token && tokenCache.bot.expiresAt > now + 60000) {
      return tokenCache.bot.token;
    }

    const tokenEndpoint = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', process.env.MICROSOFT_APP_ID);
    params.append('client_secret', process.env.MICROSOFT_APP_PASSWORD);
    params.append('scope', 'https://api.botframework.com/.default');

    const response = await httpClient.post(tokenEndpoint, params);
    const { access_token, expires_in } = response.data;

    tokenCache.bot = {
      token: access_token,
      expiresAt: now + (expires_in * 1000)
    };

    return access_token;
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
      await httpClient.post(
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
      logger.error('Error sending notification', { error: error.response?.data || error.message });
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

      logger.debug('Notification sent to approver', { approver: ticket.assigned_approver_name });
    } catch (error) {
      logger.error('Error notifying approver', { error: error.message });
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

      logger.debug('Approval notification sent to creator', { creator: ticket.created_by_name });
    } catch (error) {
      logger.error('Error notifying creator (approved)', { error: error.message });
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

      logger.debug('Rejection notification sent to creator', { creator: ticket.created_by_name });
    } catch (error) {
      logger.error('Error notifying creator (rejected)', { error: error.message });
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

      logger.debug('Cancellation notification sent to approver', { approver: ticket.assigned_approver_name });
    } catch (error) {
      logger.error('Error notifying approver (cancelled)', { error: error.message });
    }
  }

  /**
   * Send proactive Bot Framework message to approver about cancellation
   */
  static async sendCancellationBotMessage(ticket, cancellerName, reason) {
    try {
      const token = await this.getBotToken();

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
        bot: { id: process.env.MICROSOFT_APP_ID, name: 'ETILOG Portal' },
        isGroup: false,
        members: [{ id: ticket.assigned_approver_id }],
        tenantId: process.env.TENANT_ID,
        channelData: { tenant: { id: process.env.TENANT_ID } }
      };

      const conversationResponse = await httpClient.post(
        `${serviceUrl}v3/conversations`,
        conversationParams,
        { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );

      const conversationId = conversationResponse.data.id;

      // Send the message
      await httpClient.post(
        `${serviceUrl}v3/conversations/${conversationId}/activities`,
        {
          type: 'message',
          from: { id: process.env.MICROSOFT_APP_ID, name: 'ETILOG Portal' },
          conversation: { id: conversationId },
          // Teams shows this in the toast and the activity feed. Without it
          // the notification says only that a card was sent, which is true and
          // useless. It names the event as well as the subject: this is the
          // one card that arrives when something a person already approved
          // stops being true, and "Approvals — Dovolenka" would not say that.
          summary: `Approvals · Request cancelled — ${ticket.title || 'a request'}`,
          attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }]
        },
        { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      logger.error('Error sending cancellation bot message', { error: error.response?.data || error.message });
    }
  }
}

module.exports = NotificationService;
