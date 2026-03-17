const { CardFactory, TurnContext } = require('botbuilder');
const adapter = require('../bot/botAdapter');
const { createApprovalCard } = require('../cards/approvalCard');
const logger = require('../utils/logger');
require('dotenv').config();

class CardService {
  /**
   * Send approval card to manager
   */
  static async sendApprovalCard(ticket, managerId, conversationId = null) {
    try {
      const card = createApprovalCard(ticket);
      const cardAttachment = CardFactory.adaptiveCard(card);

      // Check if we should send to HR channel
      const sendToChannel = process.env.SEND_TO_HR_CHANNEL === 'true';
      const hrChannelId = process.env.HR_CHANNEL_ID;

      // Use provided conversationId or HR channel from config
      const targetChannel = conversationId || (sendToChannel ? hrChannelId : null);

      // If channel is configured, send to channel
      if (targetChannel) {
        return await this.sendToChannel(targetChannel, cardAttachment, ticket);
      }

      // Otherwise, send as direct message to manager
      return await this.sendDirectMessage(managerId, cardAttachment, ticket);
    } catch (error) {
      logger.error('Error sending approval card', { error: error.message });
      throw error;
    }
  }

  /**
   * Send card to a channel (HR channel)
   */
  static async sendToChannel(channelId, cardAttachment, ticket) {
    try {
      const tenantId = process.env.TENANT_ID;
      const serviceUrl = 'https://smba.trafficmanager.net/emea/';

      const conversationParameters = {
        isGroup: true,
        channelData: {
          channel: {
            id: channelId
          }
        },
        activity: {
          type: 'message',
          attachments: [cardAttachment]
        },
        bot: {
          id: process.env.MICROSOFT_APP_ID,
          name: 'Approval Bot'
        },
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
      logger.error('Error sending to channel', { error: error.message });
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
      logger.error('Error sending direct message', { error: error.message });
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
      logger.error('Error updating card', { error: error.message });
      throw error;
    }
  }
}

module.exports = CardService;
