const pool = require('../config');

/**
 * Published revisions of the plan.
 *
 * The planner works on the live rows, as it always has. The shop floor reads
 * the newest revision of each week - a copy of what that week looked like at a
 * moment someone chose to publish it. Nothing on the cards themselves says
 * "draft" or "published"; a revision is a copy taken alongside, so every query
 * that worked before still works untouched.
 *
 * "Unpublished changes" is therefore not a flag anyone has to maintain. It is
 * the difference between the week as it is now and the week as it was last
 * published, computed on demand. Nothing can drift out of sync, because there
 * is no second state to drift.
 */

/** The Monday of the week a date falls in, as YYYY-MM-DD. ISO, like the grid. */
function weekStartOf(date) {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;           // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/**
 * Every Monday between two dates, inclusive of the weeks they fall in.
 */
function weeksBetween(fromDate, toDate) {
  const weeks = [];
  const end = weekStartOf(toDate);
  let cursor = weekStartOf(fromDate);

  // A range is capped at 400 days upstream, so this cannot run away.
  while (cursor <= end) {
    weeks.push(cursor);
    const next = new Date(`${cursor}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    cursor = next.toISOString().slice(0, 10);
  }
  return weeks;
}

/**
 * The fields that decide whether a card counts as changed.
 *
 * Deliberately not `version` or `updated_at`: touching a card and putting it
 * back the way it was is not a change the floor needs to hear about, and a
 * publish that reports "3 changes" for three no-ops teaches people to ignore
 * the number.
 */
const ENTRY_FIELDS = [
  'production_date', 'shift_id', 'product_id', 'custom_product_name',
  'planned_quantity', 'priority', 'color', 'status', 'notes', 'sort_order',
  'fg_number', 'product_description'
];

/**
 * A production day as YYYY-MM-DD.
 *
 * Every query below asks PostgreSQL for dates as text precisely so this never
 * has to guess - but `Date` still arrives from anywhere that did not, and
 * `String(aDate)` gives "Mon Aug 31", which silently made week keys that
 * matched nothing. Formatted from the local parts rather than toISOString(),
 * because a DATE comes back as local midnight and UTC would move it a day west.
 */
const asDay = (value) => {
  if (value == null) return null;
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
};

function entryFingerprint(entry) {
  const out = {};
  for (const field of ENTRY_FIELDS) {
    let value = entry[field];
    if (field === 'production_date') value = asDay(value);
    if (field === 'planned_quantity' && value != null) value = Number(value);
    out[field] = value ?? null;
  }
  return JSON.stringify(out);
}

const flagFingerprint = (flag) => JSON.stringify([asDay(flag.production_date), flag.flag, flag.note ?? null]);
const noteFingerprint = (note) => JSON.stringify([asDay(note.production_date), note.shift_id, note.note ?? null]);

/**
 * How many differences there are between two snapshots of one week.
 *
 * Counted as things a reader would count: a card that appeared, a card that
 * went, a card that is not what it was, and the same for day flags and shift
 * notes. A card that moved is one change, not a removal plus an addition,
 * because the card is the same card.
 */
function countDifferences(before, after) {
  let changes = 0;

  const byId = (rows) => new Map((rows || []).map((row) => [row.id, row]));
  const wasEntry = byId(before?.entries);
  const nowEntry = byId(after?.entries);

  for (const [id, entry] of nowEntry) {
    const previous = wasEntry.get(id);
    if (!previous || entryFingerprint(previous) !== entryFingerprint(entry)) changes += 1;
  }
  for (const id of wasEntry.keys()) {
    if (!nowEntry.has(id)) changes += 1;
  }

  const asSet = (rows, fingerprint) => new Set((rows || []).map(fingerprint));
  const compareSets = (a, b) => {
    let diff = 0;
    for (const key of b) if (!a.has(key)) diff += 1;
    for (const key of a) if (!b.has(key)) diff += 1;
    return diff;
  };

  changes += compareSets(
    asSet(before?.dayFlags, flagFingerprint), asSet(after?.dayFlags, flagFingerprint)
  );
  changes += compareSets(
    asSet(before?.shiftNotes, noteFingerprint), asSet(after?.shiftNotes, noteFingerprint)
  );

  return changes;
}

class ProductionRevision {
  static weekStartOf = weekStartOf;
  static weeksBetween = weeksBetween;
  static countDifferences = countDifferences;

  /**
   * The week as it stands right now, in the shape a revision stores.
   *
   * Denormalised on purpose - FG numbers, descriptions and shift names as they
   * read at this moment. A revision is what the floor was told, not a pointer
   * to what the master data happens to say later.
   */
  static async buildSnapshot(locationId, weekStart, client = pool) {
    const weekEnd = new Date(`${weekStart}T00:00:00Z`);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const to = weekEnd.toISOString().slice(0, 10);

    // Sequential, not Promise.all: inside publish() this runs on a transaction
    // client, and a single pg client cannot have two queries in flight. Three
    // small indexed reads cost nothing to serialise.
    const entries = await client.query(
        // Dates as text, matching the backfill in migration 030: a production
        // day is a label, not an instant, and a timezone must never move it.
        `SELECT e.id, e.location_id,
                to_char(e.production_date, 'YYYY-MM-DD') AS production_date,
                e.shift_id, s.name AS shift_name,
                e.product_id, p.fg_number, p.description AS product_description,
                e.custom_product_name, e.planned_quantity, e.priority, e.color, e.status,
                e.notes, e.sort_order, e.version, e.updated_at, e.updated_by_name
           FROM production_plan_entries e
           LEFT JOIN products          p ON p.id = e.product_id
           LEFT JOIN production_shifts s ON s.id = e.shift_id
          WHERE e.location_id = $1
            AND e.production_date BETWEEN $2 AND $3
            AND e.deleted_at IS NULL
          ORDER BY e.production_date, s.sort_order NULLS LAST, e.sort_order, e.id`,
      [locationId, weekStart, to]
    );

    const dayFlags = await client.query(
      `SELECT id, to_char(production_date, 'YYYY-MM-DD') AS production_date, flag, note
         FROM production_day_flags
        WHERE location_id = $1 AND production_date BETWEEN $2 AND $3
        ORDER BY production_date`,
      [locationId, weekStart, to]
    );

    const shiftNotes = await client.query(
      `SELECT id, to_char(production_date, 'YYYY-MM-DD') AS production_date, shift_id, note
         FROM production_shift_notes
        WHERE location_id = $1 AND production_date BETWEEN $2 AND $3
        ORDER BY production_date, shift_id`,
      [locationId, weekStart, to]
    );

    return {
      entries: entries.rows,
      dayFlags: dayFlags.rows,
      shiftNotes: shiftNotes.rows
    };
  }

  /**
   * The newest revision of each of these weeks, keyed by week start.
   *
   * DISTINCT ON rather than a window function: it is the one query PostgreSQL
   * answers straight from the (location, week, revision DESC) index.
   */
  static async findCurrent(locationId, weekStarts) {
    if (!weekStarts.length) return {};

    const { rows } = await pool.query(
      `SELECT DISTINCT ON (week_start)
              to_char(week_start, 'YYYY-MM-DD') AS week_start,
              revision, change_count, snapshot,
              published_by_name, published_at
         FROM production_plan_revisions
        WHERE location_id = $1 AND week_start = ANY($2::date[])
        ORDER BY week_start, revision DESC`,
      [locationId, weekStarts]
    );

    const byWeek = {};
    for (const row of rows) {
      byWeek[asDay(row.week_start)] = row;
    }
    return byWeek;
  }

  /**
   * Which weeks in this range differ from what was last published, and by how
   * much. Weeks that match, and weeks that are empty and never were published,
   * are simply absent.
   */
  static async findPending(locationId, fromDate, toDate) {
    const weeks = weeksBetween(fromDate, toDate);
    const published = await ProductionRevision.findCurrent(locationId, weeks);

    const pending = [];
    for (const weekStart of weeks) {
      const current = await ProductionRevision.buildSnapshot(locationId, weekStart);
      const previous = published[weekStart];

      // Never published and nothing in it: not a pending change, just an empty
      // week nobody has touched.
      const isEmpty = !current.entries.length && !current.dayFlags.length && !current.shiftNotes.length;
      if (!previous && isEmpty) continue;

      // A published revision whose snapshot has been pruned cannot be compared.
      // Reporting it as unchanged is the safer lie: it stops a retention job
      // from silently presenting months-old weeks as needing a republish.
      if (previous && previous.snapshot == null) continue;

      const changes = countDifferences(previous?.snapshot, current);
      if (changes > 0) {
        pending.push({
          weekStart,
          changes,
          revision: previous?.revision || 0,
          publishedAt: previous?.published_at || null
        });
      }
    }
    return pending;
  }

  /**
   * Publish. Each week named gets a fresh revision holding the week as it is
   * now; weeks that have not changed are skipped rather than given an identical
   * revision nobody can tell apart from the last one.
   *
   * One transaction for all of them, so a publish is one event: either the floor
   * sees the whole set of changes or none of it.
   */
  static async publish(locationId, weekStarts, user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const published = [];
      for (const weekStart of weekStarts) {
        const { rows: last } = await client.query(
          `SELECT revision, snapshot FROM production_plan_revisions
            WHERE location_id = $1 AND week_start = $2
            ORDER BY revision DESC LIMIT 1
            FOR UPDATE`,
          [locationId, weekStart]
        );

        const snapshot = await ProductionRevision.buildSnapshot(locationId, weekStart, client);
        const previous = last[0];
        const changes = countDifferences(previous?.snapshot, snapshot);

        if (previous && changes === 0) continue;

        const { rows } = await client.query(
          `INSERT INTO production_plan_revisions
             (location_id, week_start, revision, change_count, snapshot,
              published_by, published_by_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING to_char(week_start, 'YYYY-MM-DD') AS week_start,
                     revision, change_count, published_at`,
          [
            locationId, weekStart, (previous?.revision || 0) + 1, changes,
            JSON.stringify(snapshot), user?.id || null, user?.name || null
          ]
        );
        published.push({ ...rows[0], weekStart });
      }

      await client.query('COMMIT');
      return published;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Recent publishes for a location, newest first. For the history panel. */
  static async findHistory(locationId, limit = 50) {
    const { rows } = await pool.query(
      `SELECT id, to_char(week_start, 'YYYY-MM-DD') AS week_start,
              revision, change_count, published_by_name, published_at,
              snapshot IS NOT NULL AS has_snapshot
         FROM production_plan_revisions
        WHERE location_id = $1
        ORDER BY published_at DESC, id DESC
        LIMIT $2`,
      [locationId, Math.min(Number(limit) || 50, 200)]
    );
    return rows;
  }
}

module.exports = ProductionRevision;
