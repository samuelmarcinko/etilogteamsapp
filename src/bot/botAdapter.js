const {
  CloudAdapter,
  ConfigurationServiceClientCredentialFactory,
  ConfigurationBotFrameworkAuthentication
} = require('botbuilder');
const logger = require('../utils/logger');
require('dotenv').config();

// Create adapter
const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
  MicrosoftAppId: process.env.MICROSOFT_APP_ID,
  MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD,
  MicrosoftAppType: 'SingleTenant',
  MicrosoftAppTenantId: process.env.TENANT_ID
});

const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication(
  {},
  credentialsFactory
);

const adapter = new CloudAdapter(botFrameworkAuthentication);

// Error handler
adapter.onTurnError = async (context, error) => {
  logger.error('Bot turn error', { error: error.message, stack: error.stack });

  // Send a message to the user
  await context.sendActivity('The bot encountered an error or bug.');
  await context.sendActivity('To continue to run this bot, please fix the bot source code.');
};

module.exports = adapter;
