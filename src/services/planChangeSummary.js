/**
 * What a publish changed, written the way a person would say it.
 *
 * A count is not a summary. "24 changes" tells the shop floor that something
 * happened and nothing about what, so after a week nobody reads it. What they
 * need is the sentence they would have been told across the bench: this job
 * moved to Wednesday, this one is now 240 instead of 100, this one is off the
 * plan.
 *
 * Pure - no database, no formatting for one particular medium. It turns two
 * snapshots into a structure, and `asText` renders that structure for anywhere
 * plain text goes. The screen renders the same structure its own way, so the
 * email and the wall display can never disagree about what happened.
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A production day is a label, not an instant, so it is parsed as one. */
function parseDay(iso) {
  const text = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** "Mon 22 Sep" - short enough for a line, unambiguous enough for a factory. */
function dayLabel(iso) {
  const date = parseDay(iso);
  if (!date) return 'Unscheduled';
  return `${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** ISO week number, matching the KW/WK the sheets and the grid both use. */
function isoWeek(iso) {
  const date = parseDay(iso);
  if (!date) return null;
  const thursday = new Date(date);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
}

const nameOf = (entry) =>
  entry?.fg_number || entry?.custom_product_name || `#${entry?.id}`;

const pieces = (value) =>
  value == null ? null : `${Number(value)} pcs`;

/**
 * How one card differs from itself, in the order a planner would notice.
 *
 * Day first, because that is what changes a person's week; then shift, then
 * quantity. Colour is deliberately absent: it groups related work for the eye
 * and means nothing to whoever is making the thing.
 */
function describeChange(before, after) {
  const notes = [];

  const wasDay = String(before.production_date || '').slice(0, 10);
  const nowDay = String(after.production_date || '').slice(0, 10);
  if (wasDay !== nowDay) {
    notes.push(`moved from ${dayLabel(wasDay)} to ${dayLabel(nowDay)}`);
  }

  if ((before.shift_id ?? null) !== (after.shift_id ?? null)) {
    notes.push(after.shift_name
      ? `moved to the ${after.shift_name} shift`
      : 'no longer assigned to a shift');
  }

  const wasQty = before.planned_quantity ?? null;
  const nowQty = after.planned_quantity ?? null;
  if (wasQty !== nowQty) {
    if (wasQty == null) notes.push(`quantity set to ${nowQty}`);
    else if (nowQty == null) notes.push('quantity cleared');
    else notes.push(`quantity ${wasQty} → ${nowQty}`);
  }

  if ((before.status || 'planned') !== (after.status || 'planned')) {
    notes.push(after.status === 'done' ? 'marked done' : 'reopened');
  }

  if ((before.priority || 'normal') !== (after.priority || 'normal')) {
    notes.push(after.priority === 'urgent' ? 'marked URGENT' : 'no longer urgent');
  }

  if ((before.notes || '') !== (after.notes || '')) {
    notes.push(after.notes ? 'note for the shift changed' : 'note removed');
  }

  if (nameOf(before) !== nameOf(after)) {
    notes.push(`is now ${nameOf(after)} (was ${nameOf(before)})`);
  }

  // Something in the fingerprint moved that none of the above covers - most
  // likely the card order within a shift. Saying "changed" is honest; inventing
  // a specific reason would not be.
  return notes.length ? notes : ['changed'];
}

/**
 * Turn one week's before/after into readable items.
 *
 * `weekStart` is carried through so several weeks can be summarised together
 * and still be grouped correctly on the other side.
 */
function summariseWeek(weekStart, before, after) {
  const byId = (rows) => new Map((rows || []).map((row) => [row.id, row]));
  const was = byId(before?.entries);
  const now = byId(after?.entries);

  const items = [];

  for (const [id, entry] of now) {
    const previous = was.get(id);
    const day = String(entry.production_date || '').slice(0, 10);

    if (!previous) {
      items.push({
        kind: 'added',
        id,
        weekStart,
        date: day,
        label: nameOf(entry),
        description: entry.product_description || null,
        shift: entry.shift_name || null,
        quantity: entry.planned_quantity ?? null,
        urgent: (entry.priority || 'normal') === 'urgent',
        notes: []
      });
      continue;
    }

    const changes = describeChange(previous, entry);
    // Identical cards are the common case and produce nothing at all.
    if (changes.length === 1 && changes[0] === 'changed'
        && JSON.stringify(previous) === JSON.stringify(entry)) continue;

    items.push({
      kind: 'changed',
      id,
      weekStart,
      date: day,
      label: nameOf(entry),
      description: entry.product_description || null,
      shift: entry.shift_name || null,
      quantity: entry.planned_quantity ?? null,
      urgent: (entry.priority || 'normal') === 'urgent',
      notes: changes
    });
  }

  for (const [id, entry] of was) {
    if (now.has(id)) continue;
    items.push({
      kind: 'removed',
      id,
      weekStart,
      date: String(entry.production_date || '').slice(0, 10),
      label: nameOf(entry),
      description: entry.product_description || null,
      shift: entry.shift_name || null,
      quantity: entry.planned_quantity ?? null,
      urgent: false,
      notes: []
    });
  }

  return items;
}

const KIND_ORDER = { added: 0, changed: 1, removed: 2 };

/**
 * Everything that changed, grouped the way it is read: by week, then by day.
 *
 * `weeks` is [{ weekStart, before, after }]. A week whose `before` is null was
 * published for the first time - every card in it is new, which is true and
 * worth saying once rather than card by card, so the caller decides whether to
 * include it.
 */
function summarise(weeks) {
  const items = [];
  for (const week of weeks) {
    items.push(...summariseWeek(week.weekStart, week.before, week.after));
  }

  const byWeek = new Map();
  for (const item of items) {
    if (!byWeek.has(item.weekStart)) {
      byWeek.set(item.weekStart, new Map());
    }
    const days = byWeek.get(item.weekStart);
    const key = item.date || '';
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(item);
  }

  const grouped = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, days]) => ({
      weekStart,
      calendarWeek: isoWeek(weekStart),
      days: [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, dayItems]) => ({
          date: date || null,
          label: dayLabel(date),
          items: dayItems.sort((a, b) =>
            (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || a.label.localeCompare(b.label))
        }))
    }));

  return {
    weeks: grouped,
    counts: {
      added: items.filter((i) => i.kind === 'added').length,
      changed: items.filter((i) => i.kind === 'changed').length,
      removed: items.filter((i) => i.kind === 'removed').length,
      total: items.length
    }
  };
}

/** One card as a single line. */
function lineFor(item) {
  const mark = item.kind === 'added' ? '+' : item.kind === 'removed' ? '−' : '~';
  const parts = [item.label];

  if (item.quantity != null) parts.push(pieces(item.quantity));
  if (item.shift) parts.push(item.shift);
  if (item.urgent) parts.push('URGENT');

  let line = `${mark} ${parts.join(' · ')}`;
  if (item.kind === 'removed') line += ' — removed from the plan';
  if (item.notes.length) line += ` — ${item.notes.join(', ')}`;
  return line;
}

/**
 * The summary as plain text, for anywhere plain text goes.
 *
 * Deliberately narrow and unadorned: it has to survive a Teams message, an
 * email body and a terminal without any of them making it worse.
 */
function asText(summary, { title = 'Production plan updated' } = {}) {
  if (!summary.counts.total) return `${title}\n\nNothing changed.`;

  const { added, changed, removed } = summary.counts;
  const headline = [
    added && `${added} added`,
    changed && `${changed} changed`,
    removed && `${removed} removed`
  ].filter(Boolean).join(', ');

  const lines = [title, '', headline, ''];

  for (const week of summary.weeks) {
    lines.push(`CW ${week.calendarWeek}`);
    for (const day of week.days) {
      lines.push(`  ${day.label}`);
      for (const item of day.items) lines.push(`    ${lineFor(item)}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

module.exports = {
  summarise,
  summariseWeek,
  describeChange,
  asText,
  lineFor,
  dayLabel,
  isoWeek
};
