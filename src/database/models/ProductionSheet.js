const pool = require('./../config');

/**
 * Sheet administration: creating, renaming, reordering and deleting the
 * locations that appear as tabs across the top of the plan, and switching a
 * sheet between one and two shifts.
 *
 * Kept apart from `ProductionPlan`, which only reads, and from
 * `ProductionEntry`, which writes cards. This writes the thing the cards live
 * in - a different blast radius, and worth being able to find in one file.
 *
 * ---------------------------------------------------------------------------
 * How many shifts a sheet has
 *
 * There is no `shift_mode` column, and that is on purpose. The shift rows in
 * `production_shifts` already say it: a sheet with one row is a one-shift
 * sheet, a sheet with two is a two-shift sheet. A column alongside them would
 * be a second answer to the same question, and the two would eventually
 * disagree - at which point the grid draws one thing and the database believes
 * another. So the mode is derived, never stored, and switching it means
 * actually adding or removing a shift.
 * ---------------------------------------------------------------------------
 */

/** The two shapes a sheet can have, and the shift rows each one means. */
const SINGLE = 'single';
const DOUBLE = 'double';

// A one-shift sheet keeps the name `Morning`, even though nothing on screen
// shows it. That is what makes switching to two shifts a pure insert: the
// cards already sitting there stay where they are and the afternoon arrives
// empty, which is exactly the behaviour asked for.
const MORNING = { name: 'Morning', sortOrder: 10 };
const AFTERNOON = { name: 'Afternoon', sortOrder: 20 };

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,49}$/;

class ProductionSheet {
  /**
   * Every sheet with the one fact the tab strip and the admin list need beyond
   * what `findLocations` returns: how many shifts it has.
   */
  static async list() {
    const { rows } = await pool.query(
      `SELECT l.id, l.code, l.name, l.is_internal, l.is_active, l.sort_order,
              COUNT(s.id) FILTER (WHERE s.is_active) AS shift_count
         FROM production_locations l
         LEFT JOIN production_shifts s ON s.location_id = l.id
        GROUP BY l.id
        ORDER BY l.sort_order, l.name`
    );

    return rows.map((row) => ({
      ...row,
      shift_count: Number(row.shift_count),
      shift_mode: Number(row.shift_count) > 1 ? DOUBLE : SINGLE
    }));
  }

  /**
   * What deleting this sheet would destroy.
   *
   * Asked before the confirmation is shown, because "delete PO1?" and "delete
   * PO1, with 2 840 cards and 19 published revisions?" are different questions
   * and only the second one can be answered responsibly.
   */
  static async contents(locationId) {
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM production_plan_entries
           WHERE location_id = $1 AND deleted_at IS NULL
             AND production_date IS NOT NULL)                    AS entries,
         -- Cards in the Unscheduled queue are counted on their own: they are
         -- real work that nobody looking at the calendar can see, so a warning
         -- that folded them into the total would understate what is going.
         (SELECT COUNT(*) FROM production_plan_entries
           WHERE location_id = $1 AND deleted_at IS NULL
             AND production_date IS NULL)                        AS unscheduled,
         (SELECT COUNT(*) FROM production_shift_notes
           WHERE location_id = $1)                               AS notes,
         (SELECT COUNT(*) FROM production_day_flags
           WHERE location_id = $1)                               AS day_flags,
         (SELECT COUNT(*) FROM production_plan_revisions
           WHERE location_id = $1)                               AS revisions`,
      [locationId]
    );

    const counts = Object.fromEntries(
      Object.entries(rows[0]).map(([key, value]) => [key, Number(value)])
    );
    return { ...counts, isEmpty: Object.values(counts).every((n) => n === 0) };
  }

  /**
   * A new sheet, with its shifts, in one transaction.
   *
   * A sheet without shift rows would render as a week of nothing with no way
   * to add a card, so the two are created together or not at all.
   */
  static async create({ code, name, isInternal = true, shiftMode = DOUBLE }, client = null) {
    const own = !client;
    const db = client || (await pool.connect());

    try {
      if (own) await db.query('BEGIN');

      // New sheets go to the end of the strip rather than the start: the ones
      // already there are the ones people know the position of.
      const { rows } = await db.query(
        `INSERT INTO production_locations (code, name, is_internal, is_active, sort_order)
         VALUES ($1, $2, $3, TRUE,
                 COALESCE((SELECT MAX(sort_order) FROM production_locations), 0) + 10)
         RETURNING id, code, name, is_internal, is_active, sort_order`,
        [code, name, isInternal]
      );
      const location = rows[0];

      const shifts = shiftMode === SINGLE ? [MORNING] : [MORNING, AFTERNOON];
      for (const shift of shifts) {
        await db.query(
          'INSERT INTO production_shifts (location_id, name, sort_order) VALUES ($1, $2, $3)',
          [location.id, shift.name, shift.sortOrder]
        );
      }

      if (own) await db.query('COMMIT');
      return { ...location, shift_count: shifts.length, shift_mode: shiftMode };
    } catch (error) {
      if (own) await db.query('ROLLBACK');
      throw error;
    } finally {
      if (own) db.release();
    }
  }

  /** Rename, mark external, or show/hide in the tab strip. Never the code. */
  static async update(locationId, { name, isInternal, isActive }) {
    const { rows } = await pool.query(
      `UPDATE production_locations
          SET name        = COALESCE($2, name),
              is_internal = COALESCE($3, is_internal),
              is_active   = COALESCE($4, is_active)
        WHERE id = $1
        RETURNING id, code, name, is_internal, is_active, sort_order`,
      [locationId, name ?? null, isInternal ?? null, isActive ?? null]
    );
    return rows[0];
  }

  /**
   * Move a sheet one place along the strip.
   *
   * Swaps `sort_order` with its neighbour rather than renumbering everything,
   * so two admins reordering at once cannot renumber each other's sheets into
   * a different order than either of them saw.
   */
  static async move(locationId, direction) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: current } = await client.query(
        'SELECT id, sort_order, name FROM production_locations WHERE id = $1 FOR UPDATE',
        [locationId]
      );
      if (!current.length) {
        await client.query('ROLLBACK');
        return { error: 'not_found' };
      }

      const me = current[0];
      const comparison = direction === 'up' ? '<' : '>';
      const order = direction === 'up' ? 'DESC' : 'ASC';

      // Ties on sort_order are broken by name, exactly as the listing does, so
      // the arrow moves the sheet past the neighbour the admin can see. The
      // tuple comparison is strict, so the sheet cannot match itself.
      const { rows: neighbours } = await client.query(
        `SELECT id, sort_order
           FROM production_locations
          WHERE (sort_order, name) ${comparison} ($1, $2)
          ORDER BY sort_order ${order}, name ${order}
          LIMIT 1
          FOR UPDATE`,
        [me.sort_order, me.name]
      );

      if (!neighbours.length) {
        await client.query('ROLLBACK');
        return { moved: false };      // already at the end - not an error
      }

      const neighbour = neighbours[0];
      await client.query('UPDATE production_locations SET sort_order = $2 WHERE id = $1',
                         [me.id, neighbour.sort_order]);
      await client.query('UPDATE production_locations SET sort_order = $2 WHERE id = $1',
                         [neighbour.id, me.sort_order]);

      await client.query('COMMIT');
      return { moved: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Switch a sheet between one and two shifts, carrying its cards across.
   *
   * Two → one: everything on the afternoon moves onto the remaining shift, so
   * the day ends up as one field holding both shifts' work. Notes move too,
   * and where both shifts wrote a note on the same day the two are joined
   * rather than one of them being dropped - a note someone typed is not ours
   * to throw away to satisfy a unique constraint.
   *
   * One → two: the afternoon is added empty. Nothing moves, because everything
   * is already on the morning, which is where it was asked to stay.
   *
   * All of it in one transaction: a half-converted sheet - cards pointing at a
   * shift that no longer exists - has no way back.
   */
  static async setShiftMode(locationId, mode) {
    if (mode !== SINGLE && mode !== DOUBLE) return { error: 'bad_mode' };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: shifts } = await client.query(
        `SELECT id, name, sort_order FROM production_shifts
          WHERE location_id = $1 AND is_active
          ORDER BY sort_order, name
          FOR UPDATE`,
        [locationId]
      );

      const current = shifts.length > 1 ? DOUBLE : SINGLE;
      if (current === mode) {
        await client.query('COMMIT');
        return { changed: false, shiftMode: mode, movedEntries: 0, mergedNotes: 0 };
      }

      if (mode === DOUBLE) {
        // Both rows, not just the afternoon. A sheet that somehow lost its
        // shifts would otherwise come out of here with an afternoon and no
        // morning - and `ON CONFLICT` makes doing both harmless when the
        // morning is already there.
        for (const shift of [MORNING, AFTERNOON]) {
          await client.query(
            `INSERT INTO production_shifts (location_id, name, sort_order)
             VALUES ($1, $2, $3)
             ON CONFLICT (location_id, name) DO UPDATE SET is_active = TRUE`,
            [locationId, shift.name, shift.sortOrder]
          );
        }
        await client.query('COMMIT');
        return { changed: true, shiftMode: DOUBLE, movedEntries: 0, mergedNotes: 0 };
      }

      // ---- two shifts into one -------------------------------------------
      const [keep, ...drop] = shifts;
      if (!keep) {
        // Nothing to merge into. Give the sheet its one shift rather than
        // leaving it in a state where no card can be added to it.
        await client.query(
          `INSERT INTO production_shifts (location_id, name, sort_order)
           VALUES ($1, $2, $3)
           ON CONFLICT (location_id, name) DO UPDATE SET is_active = TRUE`,
          [locationId, MORNING.name, MORNING.sortOrder]
        );
        await client.query('COMMIT');
        return { changed: true, shiftMode: SINGLE, movedEntries: 0, mergedNotes: 0 };
      }

      const dropIds = drop.map((shift) => shift.id);

      const moved = await client.query(
        `UPDATE production_plan_entries
            SET shift_id = $1
          WHERE location_id = $2 AND shift_id = ANY($3::int[])`,
        [keep.id, locationId, dropIds]
      );

      // Where the kept shift has no note that day, the note simply changes
      // shift. Where it has one, the texts are joined - in shift order, so the
      // morning's remark stays first.
      const merged = await client.query(
        `WITH incoming AS (
           SELECT production_date, string_agg(note, E'\n' ORDER BY shift_id) AS note
             FROM production_shift_notes
            WHERE location_id = $1 AND shift_id = ANY($2::int[])
            GROUP BY production_date
         )
         INSERT INTO production_shift_notes (location_id, production_date, shift_id, note)
         SELECT $1, i.production_date, $3, i.note FROM incoming i
         ON CONFLICT (location_id, production_date, shift_id)
         DO UPDATE SET note = production_shift_notes.note || E'\n' || EXCLUDED.note,
                       updated_at = CURRENT_TIMESTAMP`,
        [locationId, dropIds, keep.id]
      );

      // The notes still on the dropped shifts are gone either way - the
      // foreign key cascades - but they have just been copied across, so
      // deleting the shift rows now loses nothing.
      await client.query('DELETE FROM production_shifts WHERE id = ANY($1::int[])', [dropIds]);

      // The kept shift carries the morning's name and position whatever it was
      // called, so a later switch back to two shifts adds an afternoon rather
      // than a second row with a name that sorts first.
      await client.query(
        'UPDATE production_shifts SET name = $2, sort_order = $3 WHERE id = $1',
        [keep.id, MORNING.name, MORNING.sortOrder]
      );

      await client.query('COMMIT');
      return {
        changed: true,
        shiftMode: SINGLE,
        movedEntries: moved.rowCount,
        mergedNotes: merged.rowCount
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete a sheet and everything on it.
   *
   * Everything that hangs off a location cascades - cards, notes, day flags,
   * calendar exceptions, published revisions and the change log - so this one
   * statement is the whole deletion. There is no undo and nothing is archived;
   * the caller is responsible for having asked properly first.
   */
  static async remove(locationId) {
    const { rowCount } = await pool.query('DELETE FROM production_locations WHERE id = $1',
                                          [locationId]);
    return rowCount > 0;
  }

  /**
   * Is this a code we are willing to store?
   *
   * Codes end up in URLs and in printouts and never change afterwards, so the
   * shape is narrow. Case is the one thing normalised rather than refused -
   * the caller upper-cases first, and the form does the same as you type, so
   * what the admin sees is what gets stored. Everything else is rejected with
   * a reason instead of being quietly stripped: a code nobody typed is a code
   * nobody will recognise later.
   */
  static validateCode(code) {
    if (!code) return 'code is required';
    if (!CODE_PATTERN.test(code)) {
      return 'code must be A-Z, 0-9, dash or underscore, start alphanumeric, max 50 characters';
    }
    return null;
  }

  static get SINGLE() { return SINGLE; }
  static get DOUBLE() { return DOUBLE; }
}

module.exports = ProductionSheet;
