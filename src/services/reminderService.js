const cron = require('node-cron');
const axios = require('axios');
const Ticket = require('../database/models/Ticket');
const { createReminderCard } = require('../cards/approvalCard');
const logger = require('../utils/logger');

// Bot token cache (shared with notificationService pattern)
let botTokenCache = { token: null, expiresAt: 0 };

// Axios instance with timeout
const httpClient = axios.create({ timeout: 15000 });

class ReminderService {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Start the reminder scheduler
   * Runs once daily at 9:00 AM to check for pending tickets older than 24 hours
   */
  start() {
    if (this.isRunning) {
      logger.debug('Reminder service is already running');
      return;
    }

    // Schedule to run once daily at 9:00 AM
    this.cronJob = cron.schedule('0 9 * * *', async () => {
      logger.info('Running daily reminder check for pending approvals');
      await this.checkAndSendReminders();
    });

    this.isRunning = true;
    logger.info('Reminder service started', { schedule: 'daily at 9:00 AM' });
  }

  /**
   * Stop the reminder scheduler
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.isRunning = false;
      logger.info('Reminder service stopped');
    }
  }

  /**
   * Check for pending tickets and send reminders to approvers
   */
  async checkAndSendReminders() {
    try {
      // Get all pending tickets
      const pendingTickets = await Ticket.findAll({ status: 'Pending' });

      if (pendingTickets.length === 0) {
        logger.debug('No pending tickets found');
        return;
      }

      // Calculate cutoff time (24 hours ago)
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - 24);

      // Group tickets by approver that are older than 24 hours
      const ticketsByApprover = {};

      for (const ticket of pendingTickets) {
        const createdAt = new Date(ticket.created_at);

        // Check if ticket is older than 24 hours
        if (createdAt < cutoffTime) {
          const approverId = ticket.assigned_approver_id;

          if (!approverId) {
            logger.warn('Ticket has no assigned approver', { ticketId: ticket.ticket_id });
            continue;
          }

          if (!ticketsByApprover[approverId]) {
            ticketsByApprover[approverId] = {
              approverName: ticket.assigned_approver_name,
              tickets: []
            };
          }

          ticketsByApprover[approverId].tickets.push(ticket);
        }
      }

      // Send reminders to approvers
      const approverIds = Object.keys(ticketsByApprover);

      if (approverIds.length === 0) {
        logger.debug('No pending tickets older than 24 hours');
        return;
      }

      logger.info('Sending reminders', { approverCount: approverIds.length });

      for (const approverId of approverIds) {
        const { approverName, tickets } = ticketsByApprover[approverId];
        await this.sendReminderToApprover(approverId, approverName, tickets);
      }

      logger.info('Reminder check completed');
    } catch (error) {
      logger.error('Error checking and sending reminders', { error: error.message });
    }
  }

  /**
   * Get Bot Framework access token (with caching)
   */
  async getBotToken() {
    const now = Date.now();
    if (botTokenCache.token && botTokenCache.expiresAt > now + 60000) {
      return botTokenCache.token;
    }

    try {
      const tokenEndpoint = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', process.env.MICROSOFT_APP_ID);
      params.append('client_secret', process.env.MICROSOFT_APP_PASSWORD);
      params.append('scope', 'https://api.botframework.com/.default');

      const response = await httpClient.post(tokenEndpoint, params);
      const { access_token, expires_in } = response.data;

      botTokenCache = {
        token: access_token,
        expiresAt: now + (expires_in * 1000)
      };

      return access_token;
    } catch (error) {
      logger.error('Error getting bot token', { error: error.response?.data || error.message });
      throw error;
    }
  }

  /**
   * Send reminder message to approver using Bot Framework REST API
   */
  async sendReminderToApprover(approverId, approverName, tickets) {
    try {
      logger.debug('Sending reminder', { approver: approverName, ticketCount: tickets.length });

      // Get Bot Framework token
      const token = await this.getBotToken();

      // Create reminder card
      const reminderCard = createReminderCard(tickets);

      // Create conversation
      const serviceUrl = 'https://smba.trafficmanager.net/emea/';
      const conversationParams = {
        bot: {
          id: process.env.MICROSOFT_APP_ID,
          name: 'ETILOG Approval Bot'
        },
        isGroup: false,
        members: [{ id: approverId }],
        tenantId: process.env.TENANT_ID,
        channelData: { tenant: { id: process.env.TENANT_ID } }
      };

      // Create conversation
      const conversationResponse = await httpClient.post(
        `${serviceUrl}v3/conversations`,
        conversationParams,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const conversationId = conversationResponse.data.id;

      // Send the message with adaptive card
      const message = {
        type: 'message',
        from: {
          id: process.env.MICROSOFT_APP_ID,
          name: 'ETILOG Approval Bot'
        },
        conversation: { id: conversationId },
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: reminderCard
        }]
      };

      await httpClient.post(
        `${serviceUrl}v3/conversations/${conversationId}/activities`,
        message,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.debug('Reminder sent', { approver: approverName });
    } catch (error) {
      logger.error('Error sending reminder', { approver: approverName, error: error.response?.data || error.message });
    }
  }

  /**
   * Manually trigger reminder check (for testing)
   */
  async triggerManualCheck() {
    logger.info('Manual reminder check triggered');
    await this.checkAndSendReminders();
  }
}

module.exports = ReminderService;
