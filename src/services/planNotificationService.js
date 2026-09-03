const axios = require('axios');
const logger = require('../utils/logger');
const User = require('../database/models/User');
const PlanChangeSummary = require('./planChangeSummary');

/**
 * Tells people in Teams what a publish changed.
 *
 * Sent to whoever holds `production.notify` - a role edited in the admin screen
 * rather than a list of names in a config file, so somebody joining or leaving
 * the shift is one checkbox and not a deployment. Administrators hold every
 * permission by definition and are therefore always included.
 *
 * Reuses the bot the portal already runs: the same proactive path that tells an
 * approver their request was cancelled. Nothing new is installed in Teams.
 *
 * Nothing here may break a publish. The plan is published the moment the
 * transaction commits; a message that did not send is a message that did not
 * send, and the floor still has the screen. Every failure is logged and
 * swallowed - one person whose Teams app was never opened must not stop the
 * other fourteen being told.
 */

const SERVICE_URL = 'https://smba.trafficmanager.net/emea/';
const BOT_NAME = 'ETILOG Production Plan';

// Teams renders a card of any length, but nobody reads forty lines on a phone.
// Past this the card says how many more there are and points at the plan.
const MAX_LINES = 20;

const http = axios.create({ timeout: 15000 });

let tokenCache = { token: null, expiresAt: 0 };

/** A bot token, cached until shortly before it expires. */
async function botToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60000) return tokenCache.token;

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', process.env.MICROSOFT_APP_ID);
  params.append('client_secret', process.env.MICROSOFT_APP_PASSWORD);
  params.append('scope', 'https://api.botframework.com/.default');

  const response = await http.post(
    `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`,
    params
  );

  tokenCache = {
    token: response.data.access_token,
    expiresAt: now + (response.data.expires_in * 1000)
  };
  return tokenCache.token;
}

const MARK = { added: '➕', changed: '✏️', removed: '➖' };

/** One card line, kept to a single row so a phone shows it whole. */
function cardLine(item) {
  const parts = [`**${item.label}**`];
  if (item.quantity != null) parts.push(`${item.quantity} pcs`);
  if (item.shift) parts.push(item.shift);
  if (item.urgent) parts.push('**URGENT**');

  let line = `${MARK[item.kind]} ${parts.join(' · ')}`;
  if (item.kind === 'removed') line += ' — removed from the plan';
  if (item.notes.length) line += ` — ${item.notes.join(', ')}`;
  return line;
}

/**
 * The card, built from the same summary the screen renders.
 *
 * Week, then day, then what happened - the order it is read in. The headline
 * comes first because most people will read only that and go back to work.
 */
function buildCard(summary, { locationName, locationCode, publishedByName, planUrl }) {
  const { added, changed, removed } = summary.counts;
  const headline = [
    added && `${added} added`,
    changed && `${changed} changed`,
    removed && `${removed} removed`
  ].filter(Boolean).join(' · ');

  const body = [
    {
      type: 'Container',
      style: 'emphasis',
      items: [
        {
          type: 'TextBlock',
          text: `📋 Production plan updated — ${locationName || locationCode}`,
          weight: 'Bolder',
          size: 'Medium',
          wrap: true
        },
        {
          type: 'TextBlock',
          text: publishedByName ? `${headline} · published by ${publishedByName}` : headline,
          isSubtle: true,
          spacing: 'None',
          wrap: true
        }
      ]
    }
  ];

  let lines = 0;
  let skipped = 0;

  for (const week of summary.weeks) {
    if (lines >= MAX_LINES) {
      skipped += week.days.reduce((total, day) => total + day.items.length, 0);
      continue;
    }

    body.push({
      type: 'TextBlock',
      text: `**CW ${week.calendarWeek}**`,
      spacing: 'Medium',
      wrap: true
    });

    for (const day of week.days) {
      if (lines >= MAX_LINES) {
        skipped += day.items.length;
        continue;
      }

      body.push({
        type: 'TextBlock',
        text: day.label,
        isSubtle: true,
        size: 'Small',
        spacing: 'Small',
        wrap: true
      });

      for (const item of day.items) {
        if (lines >= MAX_LINES) { skipped += 1; continue; }
        body.push({ type: 'TextBlock', text: cardLine(item), wrap: true, spacing: 'None' });
        lines += 1;
      }
    }
  }

  if (skipped > 0) {
    body.push({
      type: 'TextBlock',
      text: `_and ${skipped} more — open the plan to see everything._`,
      isSubtle: true,
      spacing: 'Medium',
      wrap: true
    });
  }

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body,
    actions: planUrl
      ? [{ type: 'Action.OpenUrl', title: 'Open the plan', url: planUrl }]
      : []
  };
}

class PlanNotificationService {
  /**
   * Send the summary of one publish.
   *
   * `weeks` is [{ weekStart, before, after }] - the snapshots the publish moved
   * between. Returns what happened, for the log; it never throws.
   */
  static async notifyPublished({ location, weeks, publishedByName }) {
    try {
      if (!process.env.MICROSOFT_APP_ID || !process.env.MICROSOFT_APP_PASSWORD) {
        logger.debug('Plan notification skipped: the bot is not configured');
        return { sent: 0, skipped: 'bot not configured' };
      }

      const summary = PlanChangeSummary.summarise(weeks);
      // A publish that changed nothing is not news. This happens whenever
      // somebody publishes twice, and a message saying so would teach people to
      // ignore the next one.
      if (!summary.counts.total) {
        logger.debug('Plan notification skipped: nothing changed', { location: location.code });
        return { sent: 0, skipped: 'nothing changed' };
      }

      const recipients = await User.findByPermission('production.notify');
      if (!recipients.length) {
        logger.info('Plan published, but nobody holds production.notify', { location: location.code });
        return { sent: 0, skipped: 'no recipients' };
      }

      const base = process.env.APP_BASE_URL || 'https://portal.etilog.com';
      const card = buildCard(summary, {
        locationName: location.name,
        locationCode: location.code,
        publishedByName,
        planUrl: `${base}/production/view#location=${encodeURIComponent(location.code)}`
      });

      const token = await botToken();
      let sent = 0;
      const failed = [];

      for (const recipient of recipients) {
        try {
          await PlanNotificationService.sendCard(token, recipient.user_id, card);
          sent += 1;
        } catch (error) {
          // Almost always "the app was never installed for this person". Worth
          // knowing, never worth stopping for.
          failed.push({
            name: recipient.display_name || recipient.email,
            error: error.response?.data?.error?.message || error.message
          });
        }
      }

      logger.info('Plan notification sent', {
        location: location.code,
        sent,
        failed: failed.length,
        changes: summary.counts.total
      });
      if (failed.length) logger.debug('Plan notification could not reach some people', { failed });

      return { sent, failed: failed.length, counts: summary.counts };
    } catch (error) {
      // The plan is already published. This is the part that may fail.
      logger.error('Plan notification failed', { error: error.message });
      return { sent: 0, error: error.message };
    }
  }

  /** Open a one-to-one chat with somebody and put the card in it. */
  static async sendCard(token, teamsUserId, card) {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const conversation = await http.post(
      `${SERVICE_URL}v3/conversations`,
      {
        bot: { id: process.env.MICROSOFT_APP_ID, name: BOT_NAME },
        isGroup: false,
        members: [{ id: teamsUserId }],
        tenantId: process.env.TENANT_ID,
        channelData: { tenant: { id: process.env.TENANT_ID } }
      },
      { headers }
    );

    const conversationId = conversation.data.id;

    await http.post(
      `${SERVICE_URL}v3/conversations/${conversationId}/activities`,
      {
        type: 'message',
        from: { id: process.env.MICROSOFT_APP_ID, name: BOT_NAME },
        conversation: { id: conversationId },
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: card
        }]
      },
      { headers }
    );
  }
}

module.exports = PlanNotificationService;
module.exports.buildCard = buildCard;
module.exports.cardLine = cardLine;
