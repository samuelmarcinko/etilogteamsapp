const cron = require('node-cron');
const { BotFrameworkAdapter, CardFactory } = require('botbuilder');
const Ticket = require('../database/models/Ticket');
const { createReminderCard } = require('../cards/approvalCard');

class ReminderService {
  constructor(adapter) {
    this.adapter = adapter;
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
   * Send reminder message to approver
   */
  async sendReminderToApprover(approverId, approverName, tickets) {
    try {
      console.log(`📤 Sending reminder to ${approverName} (${tickets.length} ticket(s))`);

      // Create reminder card
      const reminderCard = createReminderCard(tickets);

      // Create conversation parameters for 1:1 chat
      const conversationParameters = {
        isGroup: false,
        bot: {
          id: process.env.MICROSOFT_APP_ID,
          name: 'ETILOG Approval Bot'
        },
        members: [{ id: approverId }],
        tenantId: process.env.TENANT_ID
      };

      // Send the reminder card
      await this.adapter.createConversation(
        'msteams',
        process.env.APP_BASE_URL,
        process.env.MICROSOFT_APP_ID,
        conversationParameters,
        async (turnContext) => {
          await turnContext.sendActivity({
            attachments: [CardFactory.adaptiveCard(reminderCard)]
          });
        }
      );

      console.log(`✅ Reminder sent to ${approverName}`);
    } catch (error) {
      console.error(`❌ Error sending reminder to ${approverName}:`, error);
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
