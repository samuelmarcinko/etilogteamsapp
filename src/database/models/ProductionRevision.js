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

/**
 * WHICH cards changed between two published revisions, not just how many.
 *
 * The floor is told the plan changed; what it needs to see is where. A card
 * that appeared, a card that is not what it was - moved, requantified,
 * recoloured - and a card that is gone. Removals carry their label because
 * there is nothing left on screen to attach them to.
 *
 * A card that moved is one change and keeps its identity, the same reading
 * countDifferences takes: it is the same card, on a different day.
 */
function diffEntries(before, after) {
  const byId = (rows) => new Map((rows || []).map((row) => [row.id, row]));
  const was = byId(before?.entries);
  const now = byId(after?.entries);

  const added = [];
  const changed = [];
  const removed = [];

  for (const [id, entry] of now) {
    const previous = was.get(id);
    if (!previous) added.push(id);
    else if (entryFingerprint(previous) !== entryFingerprint(entry)) changed.push(id);
  }

  for (const [id, entry] of was) {
    if (now.has(id)) continue;
    removed.push({
      id,
      label: entry.fg_number || entry.custom_product_name || `#${id}`,
      productionDate: entry.production_date || null,
      quantity: entry.planned_quantity ?? null
    });
  }

  return { added, changed, removed };
}

class ProductionRevision {
  static weekStartOf = weekStartOf;
  static weeksBetween = weeksBetween;
  static countDifferences = countDifferences;
  static diffEntries = diffEntries;

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
   * The revision published before the current one, per week.
   *
   * Only the snapshot is needed, and only to compare against - so a week with
   * just one revision (nothing published before it) is simply absent, and
   * everything in it reads as new, which is what it is.
   */
  static async findPrevious(locationId, weekStarts) {
    if (!weekStarts.length) return {};

    const { rows } = await pool.query(
      `SELECT DISTINCT ON (week_start)
              to_char(week_start, 'YYYY-MM-DD') AS week_start,
              revision, snapshot
         FROM production_plan_revisions r
        WHERE location_id = $1 AND week_start = ANY($2::date[])
          AND revision < (
              SELECT max(revision) FROM production_plan_revisions
               WHERE location_id = r.location_id AND week_start = r.week_start
          )
        ORDER BY week_start, revision DESC`,
      [locationId, weekStarts]
    );

    const byWeek = {};
    for (const row of rows) byWeek[asDay(row.week_start)] = row;
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
        // The snapshots go out with the result so a notification can say WHAT
        // changed. They are already in hand here; fetching them again outside
        // the transaction would risk describing a different publish than the
        // one that just happened.
        published.push({
          ...rows[0],
          weekStart,
          before: previous?.snapshot || null,
          after: snapshot
        });
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

  /**
   * Mark a card done (or reopen it) in the revision the floor is currently
   * reading, without publishing anything.
   *
   * "Done" is a record of what happened, not a change to the plan. Making the
   * planner publish it would be backwards on both counts: the floor would keep
   * seeing finished work as outstanding until somebody remembered to press a
   * button, and everyone on the notification list would be told the plan
   * changed when it did not. So the status is written straight into the newest
   * revision of that week, in place - no new revision, no change_count, nobody
   * notified, and the production view shows it on its next poll.
   *
   * Only `status` is ever patched this way. Priority and colour are decisions
   * about what the floor should do next, and those still wait for a publish.
   *
   * If the card is not in that revision at all - it was added, or moved into
   * this week, and never published - there is nothing to correct: the floor is
   * not being shown the card, and the pending publish already carries it, with
   * whatever status it has by then.
   */
  static async patchEntryStatus(locationId, entry, status) {
    const productionDate = asDay(entry?.production_date);
    if (!productionDate || !entry?.id) return { patched: false, reason: 'unscheduled' };

    const weekStart = weekStartOf(productionDate);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT id, snapshot FROM production_plan_revisions
          WHERE location_id = $1 AND week_start = $2
          ORDER BY revision DESC LIMIT 1
          FOR UPDATE`,
        [locationId, weekStart]
      );

      const revision = rows[0];
      if (!revision?.snapshot?.entries) {
        await client.query('ROLLBACK');
        return { patched: false, reason: 'never published' };
      }

      const snapshot = revision.snapshot;
      const card = snapshot.entries.find((row) => String(row.id) === String(entry.id));
      if (!card || card.status === status) {
        await client.query('ROLLBACK');
        return { patched: false, reason: card ? 'already' : 'not in revision' };
      }

      card.status = status;
      // Kept in step with the live row so the two tell the same story about who
      // last touched the card. Neither field counts towards a change.
      card.updated_at = entry.updated_at || card.updated_at;
      card.updated_by_name = entry.updated_by_name ?? card.updated_by_name;

      await client.query(
        'UPDATE production_plan_revisions SET snapshot = $2 WHERE id = $1',
        [revision.id, JSON.stringify(snapshot)]
      );

      await client.query('COMMIT');
      return { patched: true, weekStart };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Put the day marks - Free, Important - straight into the revision the
   * production view is reading, without publishing anything.
   *
   * Same reasoning as marking a card done. "Saturday is free" and "Thursday
   * matters" are facts about the day rather than decisions about what to build;
   * holding them behind a publish would leave the production view showing an
   * ordinary Thursday, and would mail everyone on the list about a plan whose
   * work did not move at all.
   *
   * The whole week's flags are re-read and replaced rather than the one row
   * being edited in place. Setting a flag, changing it and clearing it are
   * three different edits to the same slot, and a function that copies the
   * live answer for the week cannot get any of them subtly wrong.
   */
  static async patchDayFlags(locationId, date) {
    const day = asDay(date);
    if (!day) return { patched: false, reason: 'no date' };

    const weekStart = weekStartOf(day);
    const weekEnd = new Date(`${weekStart}T00:00:00Z`);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const to = weekEnd.toISOString().slice(0, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT id, snapshot FROM production_plan_revisions
          WHERE location_id = $1 AND week_start = $2
          ORDER BY revision DESC LIMIT 1
          FOR UPDATE`,
        [locationId, weekStart]
      );

      const revision = rows[0];
      if (!revision?.snapshot) {
        await client.query('ROLLBACK');
        return { patched: false, reason: 'never published' };
      }

      // The same query buildSnapshot uses, so the two shapes cannot drift.
      const live = await client.query(
        `SELECT id, to_char(production_date, 'YYYY-MM-DD') AS production_date, flag, note
           FROM production_day_flags
          WHERE location_id = $1 AND production_date BETWEEN $2 AND $3
          ORDER BY production_date`,
        [locationId, weekStart, to]
      );

      const snapshot = { ...revision.snapshot, dayFlags: live.rows };

      await client.query(
        'UPDATE production_plan_revisions SET snapshot = $2 WHERE id = $1',
        [revision.id, JSON.stringify(snapshot)]
      );

      await client.query('COMMIT');
      return { patched: true, weekStart };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * What discarding these weeks would cost, before anyone commits to it.
   *
   * Counted the way the planner would count it looking at the screen: cards
   * that go, cards that come back, cards that return to what they were. Plus
   * who has touched the week since it was published - the difference is
   * computed against a snapshot and carries no notion of whose change is
   * whose, so the only honest thing to do is name everyone who has been in
   * there and let the planner decide whether they are about to throw away
   * somebody else's afternoon.
   */
  static async previewDiscard(locationId, weekStarts) {
    const published = await ProductionRevision.findCurrent(locationId, weekStarts);

    const weeks = [];
    for (const weekStart of weekStarts) {
      const live = await ProductionRevision.buildSnapshot(locationId, weekStart);
      const before = published[weekStart]?.snapshot || null;
      const diff = diffEntries(before, live);

      const flagsDiffer =
        JSON.stringify((before?.dayFlags || []).map(flagFingerprint).sort())
        !== JSON.stringify((live.dayFlags || []).map(flagFingerprint).sort());
      const notesDiffer =
        JSON.stringify((before?.shiftNotes || []).map(noteFingerprint).sort())
        !== JSON.stringify((live.shiftNotes || []).map(noteFingerprint).sort());

      if (!diff.added.length && !diff.changed.length && !diff.removed.length
          && !flagsDiffer && !notesDiffer) continue;

      // Who has been in here since the publish. Only the cards that actually
      // differ, so a name does not appear because of work that was published.
      const touched = new Set();
      const byId = new Map((live.entries || []).map((row) => [row.id, row]));
      for (const id of [...diff.added, ...diff.changed]) {
        const name = byId.get(id)?.updated_by_name;
        if (name) touched.add(name);
      }

      weeks.push({
        weekStart,
        // 0 means this week has never been published, and discarding it deletes
        // everything in it rather than putting anything back. The screen says so
        // in those words - it is the one case where "discard" is not a rollback.
        revision: published[weekStart]?.revision || 0,
        publishedAt: published[weekStart]?.published_at || null,
        willDelete: diff.added.length,
        willRestore: diff.removed.length,
        willRevert: diff.changed.length,
        dayMarksChange: flagsDiffer,
        shiftNotesChange: notesDiffer,
        touchedBy: [...touched]
      });
    }
    return weeks;
  }

  /**
   * Make the live plan match a set of week snapshots again.
   *
   * The single write path behind both Discard - where the targets are the
   * published revisions - and its undo, where they are the snapshots taken of
   * the live weeks a moment before. One code path means undo cannot restore
   * something discard does not touch, or miss something it does.
   *
   * Entries are settled across the whole set before anything is deleted rather
   * than week by week: a card dragged from CW36 to CW40 belongs to both weeks,
   * and processing them in order would have the second pass delete what the
   * first had just put back.
   */
  static async restoreLive(locationId, targets, user, action = 'discarded') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const undo = [];
      const wanted = new Map();        // id -> the row as the target holds it
      const weekStarts = [];

      for (const target of targets) {
        weekStarts.push(target.weekStart);
        // The live week as it stands, so this operation can be undone.
        undo.push({
          weekStart: target.weekStart,
          snapshot: await ProductionRevision.buildSnapshot(locationId, target.weekStart, client)
        });
        for (const entry of target.snapshot?.entries || []) wanted.set(entry.id, entry);
      }

      let reverted = 0;
      let missing = 0;
      for (const [id, entry] of wanted) {
        const { rowCount } = await client.query(
          `UPDATE production_plan_entries
              SET production_date = $2, shift_id = $3, product_id = $4,
                  custom_product_name = $5, planned_quantity = $6, priority = $7,
                  color = $8, status = $9, notes = $10, sort_order = $11,
                  deleted_at = NULL, version = version + 1,
                  updated_by = $12, updated_by_name = $13
            WHERE id = $1 AND location_id = $14`,
          [
            id, asDay(entry.production_date), entry.shift_id || null,
            entry.product_id || null, entry.custom_product_name || null,
            entry.planned_quantity ?? null, entry.priority || 'normal',
            entry.color || null, entry.status || 'planned', entry.notes || null,
            entry.sort_order ?? 0, user?.id || null, user?.name || null, locationId
          ]
        );
        // A row erased outright rather than soft-deleted cannot be brought
        // back, and pretending otherwise would be worse than saying so.
        if (rowCount) reverted += 1; else missing += 1;
      }

      // Anything live in these weeks that the targets do not hold. Computed
      // after the restores above, so a card that has just been moved back into
      // one of these weeks is not then deleted out of it.
      const { rows: strays } = await client.query(
        `SELECT id FROM production_plan_entries
          WHERE location_id = $1 AND deleted_at IS NULL
            AND production_date IS NOT NULL
            AND date_trunc('week', production_date)::date = ANY($2::date[])
            AND NOT (id = ANY($3::int[]))`,
        [locationId, weekStarts, [...wanted.keys()]]
      );

      for (const stray of strays) {
        await client.query(
          `UPDATE production_plan_entries
              SET deleted_at = CURRENT_TIMESTAMP, version = version + 1,
                  updated_by = $2, updated_by_name = $3
            WHERE id = $1`,
          [stray.id, user?.id || null, user?.name || null]
        );
      }

      // Day marks and shift notes are replaced wholesale per week, for the
      // same reason patchDayFlags does: set, changed and cleared are three
      // edits to one slot, and copying the answer cannot get any of them wrong.
      for (const target of targets) {
        const weekEnd = new Date(`${target.weekStart}T00:00:00Z`);
        weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
        const to = weekEnd.toISOString().slice(0, 10);

        await client.query(
          `DELETE FROM production_day_flags
            WHERE location_id = $1 AND production_date BETWEEN $2 AND $3`,
          [locationId, target.weekStart, to]
        );
        for (const flag of target.snapshot?.dayFlags || []) {
          await client.query(
            `INSERT INTO production_day_flags (location_id, production_date, flag, note, created_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (location_id, production_date)
             DO UPDATE SET flag = EXCLUDED.flag, note = EXCLUDED.note`,
            [locationId, asDay(flag.production_date), flag.flag, flag.note || null, user?.id || null]
          );
        }

        await client.query(
          `DELETE FROM production_shift_notes
            WHERE location_id = $1 AND production_date BETWEEN $2 AND $3`,
          [locationId, target.weekStart, to]
        );
        for (const note of target.snapshot?.shiftNotes || []) {
          if (!note.note) continue;
          await client.query(
            `INSERT INTO production_shift_notes (location_id, production_date, shift_id, note, created_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (location_id, production_date, shift_id)
             DO UPDATE SET note = EXCLUDED.note`,
            [locationId, asDay(note.production_date), note.shift_id, note.note, user?.id || null]
          );
        }
      }

      await client.query(
        `INSERT INTO production_change_log
           (location_id, entry_id, action, summary, before_state, after_state, changed_by, changed_by_name)
         VALUES ($1, NULL, $7, $2, $3, $4, $5, $6)`,
        [
          locationId,
          `${action === 'discarded' ? 'Discarded unpublished changes in' : 'Took back the discard across'} `
            + `${weekStarts.length} week(s): ${strays.length} card(s) removed, ${reverted} put back`,
          JSON.stringify(undo.map((week) => ({ weekStart: week.weekStart, entries: week.snapshot.entries.length }))),
          JSON.stringify(targets.map((t) => ({ weekStart: t.weekStart, entries: (t.snapshot?.entries || []).length }))),
          user?.id || null, user?.name || null, action
        ]
      );

      await client.query('COMMIT');
      return { deleted: strays.length, reverted, missing, undo };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Throw away everything unpublished in these weeks.
   *
   * The one operation in the module that can destroy work, so it is deliberately
   * the thinnest possible wrapper: read what was published, hand it to
   * restoreLive, and give back the undo it produced. A week that was never
   * published restores to nothing, which is what "back to the last publish"
   * means there - the screen has to have said so first.
   */
  static async discard(locationId, weekStarts, user) {
    const published = await ProductionRevision.findCurrent(locationId, weekStarts);
    const targets = weekStarts.map((weekStart) => ({
      weekStart,
      snapshot: published[weekStart]?.snapshot || { entries: [], dayFlags: [], shiftNotes: [] }
    }));
    return ProductionRevision.restoreLive(locationId, targets, user);
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
