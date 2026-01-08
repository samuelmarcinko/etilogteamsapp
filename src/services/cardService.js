const { CardFactory, TurnContext } = require('botbuilder');
const adapter = require('../bot/botAdapter');
const { createApprovalCard } = require('../cards/approvalCard');
require('dotenv').config();

class CardService {
  /**
   * Send approval card to manager
   */
  static async sendApprovalCard(ticket, managerId, conversationId = null) {
    try {
      const card = createApprovalCard(ticket);
      const cardAttachment = CardFactory.adaptiveCard(card);

      // If conversationId is provided (channel), send to channel
      if (conversationId) {
        return await this.sendToConversation(conversationId, cardAttachment);
      }

      // Otherwise, send as direct message to manager
      return await this.sendDirectMessage(managerId, cardAttachment, ticket);
    } catch (error) {
      console.error('Error sending approval card:', error);
      throw error;
    }
  }

  /**
   * Send card to a conversation (channel)
   */
  static async sendToConversation(conversationId, cardAttachment) {
    try {
      // This requires a conversation reference or service URL
      // For now, we'll return the card data to be sent via the API
      return {
        conversationId,
        attachment: cardAttachment
      };
    } catch (error) {
      console.error('Error sending to conversation:', error);
      throw error;
    }
  }

  /**
   * Send direct message to user
   */
  static async sendDirectMessage(userId, cardAttachment, ticket) {
    try {
      const tenantId = process.env.TENANT_ID;
      const serviceUrl = 'https://smba.trafficmanager.net/emea/';

      const conversationParameters = {
        isGroup: false,
        bot: {
          id: process.env.MICROSOFT_APP_ID,
          name: 'Approval Bot'
        },
        members: [{ id: userId }],
        tenantId: tenantId
      };

      let conversationReference;
      let activityId;

      await adapter.createConversation(
        'msteams',
        serviceUrl,
        process.env.MICROSOFT_APP_ID,
        conversationParameters,
        async (turnContext) => {
          const activity = {
            type: 'message',
            attachments: [cardAttachment]
          };

          const response = await turnContext.sendActivity(activity);
          activityId = response.id;

          conversationReference = TurnContext.getConversationReference(turnContext.activity);
        }
      );

      return {
        conversationReference,
        activityId,
        success: true
      };
    } catch (error) {
      console.error('Error sending direct message:', error);
      throw error;
    }
  }

  /**
   * Update existing card
   */
  static async updateCard(conversationReference, activityId, newCard) {
    try {
      await adapter.continueConversation(
        conversationReference,
        async (turnContext) => {
          const cardAttachment = CardFactory.adaptiveCard(newCard);
          await turnContext.updateActivity({
            id: activityId,
            type: 'message',
            attachments: [cardAttachment]
          });
        }
      );

      return { success: true };
    } catch (error) {
      console.error('Error updating card:', error);
      throw error;
    }
  }
}

module.exports = CardService;
