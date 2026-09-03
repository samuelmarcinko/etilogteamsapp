/**
 * The publish summary as an email.
 *
 * Built from the same structure the screen and the Teams card render, so the
 * three can never tell different stories about one publish.
 *
 * Written for email clients, not browsers: tables for layout, every style
 * inline, no flexbox, no grid, no external stylesheet and no web font. Outlook
 * on the desktop renders through Word and drops all of those silently, which is
 * how a mail that looked right in testing arrives as a column of unstyled text.
 * The layout below survives because it asks for nothing that can be dropped.
 */

const ETILOG_RED = '#D9000C';

const COLOURS = {
  added: { text: '#1B6E45', background: '#E7F3EC', mark: '+' },
  changed: { text: '#9C5C00', background: '#FBF0DE', mark: '~' },
  removed: { text: ETILOG_RED, background: '#FDECEC', mark: '−' }
};

const FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/** Email bodies are HTML, and FG numbers and notes come from people. */
function escape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One card: what it is, how much of it, and what happened to it. */
function itemRow(item) {
  const colour = COLOURS[item.kind] || COLOURS.changed;

  const facts = [
    item.quantity != null ? `${item.quantity} pcs` : null,
    item.shift || null
  ].filter(Boolean).map(escape).join(' &middot; ');

  const note = item.kind === 'removed'
    ? 'removed from the plan'
    : item.notes.join(', ');

  return `
    <tr>
      <td style="padding:8px 10px;vertical-align:top;width:26px;">
        <span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;
                     border-radius:10px;font-family:${FONT};font-size:13px;font-weight:700;
                     color:${colour.text};background:${colour.background};">${colour.mark}</span>
      </td>
      <td style="padding:8px 10px 8px 0;vertical-align:top;font-family:${FONT};">
        <div style="font-size:14px;font-weight:600;color:#1A1513;">
          ${escape(item.label)}${item.urgent
            ? ` <span style="font-size:11px;font-weight:700;color:${ETILOG_RED};
                             background:#FDECEC;padding:1px 5px;border-radius:3px;">URGENT</span>`
            : ''}
        </div>
        ${facts ? `<div style="font-size:12px;color:#7B706B;margin-top:2px;">${facts}</div>` : ''}
        ${note ? `<div style="font-size:13px;color:#4A403C;margin-top:3px;">${escape(note)}</div>` : ''}
      </td>
    </tr>`;
}

function dayBlock(day) {
  return `
    <tr>
      <td style="padding:14px 0 2px;font-family:${FONT};font-size:12px;font-weight:700;
                 color:#7B706B;text-transform:uppercase;letter-spacing:0.06em;">
        ${escape(day.label)}
      </td>
    </tr>
    <tr>
      <td>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
               style="border:1px solid #E4DCD8;border-radius:6px;background:#FFFFFF;">
          ${day.items.map(itemRow).join('')}
        </table>
      </td>
    </tr>`;
}

function weekBlock(week) {
  return `
    <tr>
      <td style="padding:22px 0 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="font-family:${FONT};font-size:16px;font-weight:700;color:#1A1513;
                       border-bottom:2px solid ${ETILOG_RED};padding-bottom:6px;">
              CW ${escape(week.calendarWeek)}
            </td>
          </tr>
          ${week.days.map(dayBlock).join('')}
        </table>
      </td>
    </tr>`;
}

/**
 * The whole email.
 *
 * The headline sits above everything because most people read that and go back
 * to work; the detail is there for whoever needs to act on it.
 */
function buildEmail(summary, { locationName, locationCode, publishedByName, planUrl }) {
  const { added, changed, removed } = summary.counts;
  const headline = [
    added && `${added} added`,
    changed && `${changed} changed`,
    removed && `${removed} removed`
  ].filter(Boolean).join(' &middot; ');

  const where = escape(locationName || locationCode);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F0EE;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="background:#F4F0EE;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
               style="width:600px;max-width:100%;background:#FBF9F8;border:1px solid #E4DCD8;
                      border-radius:10px;overflow:hidden;">

          <tr>
            <td style="background:#FFFFFF;border-bottom:3px solid ${ETILOG_RED};padding:20px 24px;">
              <div style="font-family:${FONT};font-size:11px;font-weight:700;color:#7B706B;
                          text-transform:uppercase;letter-spacing:0.12em;">ETILOG &middot; Production plan</div>
              <div style="font-family:${FONT};font-size:20px;font-weight:700;color:#1A1513;margin-top:6px;">
                The plan changed &mdash; ${where}
              </div>
              <div style="font-family:${FONT};font-size:14px;color:#4A403C;margin-top:4px;">
                ${headline}${publishedByName ? ` &middot; published by ${escape(publishedByName)}` : ''}
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:4px 24px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${summary.weeks.map(weekBlock).join('')}
              </table>

              ${planUrl ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;">
                <tr>
                  <td style="background:${ETILOG_RED};border-radius:6px;">
                    <a href="${escape(planUrl)}"
                       style="display:inline-block;padding:11px 22px;font-family:${FONT};font-size:14px;
                              font-weight:600;color:#FFFFFF;text-decoration:none;">Open the plan</a>
                  </td>
                </tr>
              </table>` : ''}
            </td>
          </tr>

          <tr>
            <td style="background:#F4F0EE;border-top:1px solid #E4DCD8;padding:14px 24px;
                       font-family:${FONT};font-size:12px;color:#7B706B;">
              This is what the production view now shows. You are receiving it because you are
              listed for production plan notifications in the ETILOG Portal.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { buildEmail };
