const cron = require('node-cron');
const axios = require('axios');
const Ticket = require('../database/models/Ticket');
const { createReminderCard } = require('../cards/approvalCard');

class ReminderService {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Start the reminder scheduler
   * Runs every hour to check for pending tickets older than 24 hours
   */
  start() {
    if (this.isRunning) {
      console.log('⏰ Reminder service is already running');
      return;
    }

    // Schedule to run every hour at minute 0
    // Cron format: minute hour day month dayOfWeek
    this.cronJob = cron.schedule('0 * * * *', async () => {
      console.log('⏰ Running reminder check for pending approvals...');
      await this.checkAndSendReminders();
    });

    this.isRunning = true;
    console.log('✅ Reminder service started - will check for pending approvals every hour');
  }

  /**
   * Stop the reminder scheduler
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.isRunning = false;
      console.log('🛑 Reminder service stopped');
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
        console.log('✅ No pending tickets found');
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
            console.log(`⚠️ Ticket ${ticket.ticket_id} has no assigned approver`);
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
        console.log('✅ No pending tickets older than 24 hours');
        return;
      }

      console.log(`📧 Sending reminders to ${approverIds.length} approver(s)`);

      for (const approverId of approverIds) {
        const { approverName, tickets } = ticketsByApprover[approverId];
        await this.sendReminderToApprover(approverId, approverName, tickets);
      }

      console.log('✅ Reminder check completed');
    } catch (error) {
      console.error('❌ Error checking and sending reminders:', error);
    }
  }

  /**
   * Get Bot Framework access token
   */
  async getBotToken() {
    try {
      const tokenEndpoint = 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', process.env.MICROSOFT_APP_ID);
      params.append('client_secret', process.env.MICROSOFT_APP_PASSWORD);
      params.append('scope', 'https://api.botframework.com/.default');

      const response = await axios.post(tokenEndpoint, params);
      return response.data.access_token;
    } catch (error) {
      console.error('Error getting bot token:', error);
      throw error;
    }
  }

  /**
   * Send reminder message to approver using Bot Framework REST API
   */
  async sendReminderToApprover(approverId, approverName, tickets) {
    try {
      console.log(`📤 Sending reminder to ${approverName} (${tickets.length} ticket(s))`);

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
        members: [
          {
            id: approverId
          }
        ],
        tenantId: process.env.TENANT_ID,
        channelData: {
          tenant: {
            id: process.env.TENANT_ID
          }
        }
      };

      // Create conversation
      const conversationResponse = await axios.post(
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
        conversation: {
          id: conversationId
        },
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: reminderCard
          }
        ]
      };

      await axios.post(
        `${serviceUrl}v3/conversations/${conversationId}/activities`,
        message,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`✅ Reminder sent to ${approverName}`);
    } catch (error) {
      console.error(`❌ Error sending reminder to ${approverName}:`, error.response?.data || error.message);
    }
  }

  /**
   * Manually trigger reminder check (for testing)
   */
  async triggerManualCheck() {
    console.log('🔄 Manual reminder check triggered');
    await this.checkAndSendReminders();
  }
}

module.exports = ReminderService;
