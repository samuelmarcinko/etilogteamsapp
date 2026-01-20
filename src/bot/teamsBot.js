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

      // Greeting commands
      if (text === 'hello' || text === 'hi' || text === 'ahoj' || text === 'nazdar') {
        await context.sendActivity('Ahoj! Som ETILOG Approval Bot 🎫\n\nPomáham spravovať žiadosti o schválenie. Napíš "help" alebo "pomoc" pre viac informácií.');
      }
      // Help commands
      else if (text === 'help' || text === 'pomoc' || text === 'napoveda') {
        await context.sendActivity(this.getHelpMessage());
      }
      // Status command - check pending approvals
      else if (text === 'status' || text === 'stav') {
        await context.sendActivity('ℹ️ Pre zobrazenie stavu tvojich žiadostí otvor aplikáciu cez záložku "Moje žiadosti".\n\nPre schvaľovanie žiadostí klikni na záložku "Schvaľovanie".');
      }
      // My requests command
      else if (text === 'my requests' || text === 'moje ziadosti' || text === 'moje žiadosti') {
        await context.sendActivity('📋 Tvoje žiadosti nájdeš v aplikácii v záložke "My Requests" alebo "Moje žiadosti".');
      }
      // Create request command
      else if (text === 'create' || text === 'vytvoriť' || text === 'vytvorit' || text === 'nova ziadost') {
        await context.sendActivity('➕ Pre vytvorenie novej žiadosti otvor aplikáciu a prejdi do záložky "Create Request" alebo "Vytvoriť žiadosť".');
      }
      // About command
      else if (text === 'about' || text === 'o aplikácii' || text === 'o aplikacii' || text === 'info') {
        await context.sendActivity(this.getAboutMessage());
      }
      // Default response
      else {
        await context.sendActivity('❓ Nerozumiem príkazu. Napíš "help" alebo "pomoc" pre zoznam dostupných príkazov.');
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
      console.error('Error handling adaptive card action:', error);
      return this.createInvokeResponse(500, 'Internal server error');
    }
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
   * Get welcome message (Slovak version)
   */
  getWelcomeMessage() {
    return `🎉 Vitaj v ETILOG Approval Center! 🎫

Som tvoj asistent pre správu schvaľovacích žiadostí.

**Čo viem robiť:**
✅ Odosielať žiadosti schvaľovateľom
✅ Spracovávať schválenia a zamietnutia
✅ Posielať notifikácie o stave žiadostí
📊 Pomáhať s dovolenkami, nákupmi, výdavkami a HR záležitosťami

**Začni hneď:**
- Napíš **"help"** alebo **"pomoc"** pre zoznam príkazov
- Otvor aplikáciu v Teams záložke pre vytvorenie žiadosti

Prajem príjemnú prácu! 💼`;
  }

  /**
   * Get help message (Slovak version)
   */
  getHelpMessage() {
    return `**📖 ETILOG Approval Bot - Nápoveda**

**🙋 Pre žiadateľov:**
• Vytváraj žiadosti cez aplikáciu (dovolenka, nákupy, výdavky, HR)
• Sleduj stav svojich žiadostí
• Dostávaj notifikácie o schválení/zamietnutí

**👨‍💼 Pre schvaľovateľov:**
• Prijímaj žiadosti ako Adaptive Cards
• Klikni "Approve" alebo "Reject" pre spracovanie
• Pridaj dôvod zamietnutia (voliteľné)

**💬 Dostupné príkazy:**
• \`hello\` / \`ahoj\` - Pozdrav bota
• \`help\` / \`pomoc\` - Zobraz túto nápovedu
• \`status\` / \`stav\` - Info o žiadostiach
• \`create\` / \`vytvoriť\` - Ako vytvoriť žiadosť
• \`my requests\` / \`moje žiadosti\` - Kde nájsť moje žiadosti
• \`about\` / \`info\` - O aplikácii

**🆘 Potrebuješ pomoc?**
Kontaktuj IT oddelenie: it@etilog.com`;
  }

  /**
   * Get about message (Slovak version)
   */
  getAboutMessage() {
    return `**ℹ️ O ETILOG Approval Center**

**Verzia:** 1.0.0
**Developer:** ETILOG IT Team
**Posledná aktualizácia:** Január 2026

**Funkcie:**
✅ Schvaľovanie dovoleniek a PN-iek
✅ Schvaľovanie nákupov a výdavkov
✅ HR žiadosti
✅ Real-time notifikácie
✅ Slovenská aj anglická verzia
✅ Pulzujúce badge notifikácie

**Technológie:**
• Microsoft Teams Platform
• Node.js + Express
• PostgreSQL Database
• Adaptive Cards

**Podpora:**
📧 it@etilog.com
🌐 https://etilog.com

Ďakujeme za používanie! 🎉`;
  }
}

module.exports = TeamsBot;
