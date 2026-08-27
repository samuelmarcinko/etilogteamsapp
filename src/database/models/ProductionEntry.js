const pool = require('../config');

/**
 * Writes against production_plan_entries (migrations 025, 026).
 *
 * Two rules run through everything here:
 *
 * - A move is one transaction. Swapping two cards or replacing one must never
 *   land half-applied, leaving production looking at a plan that never existed.
 * - Every write returns an `undo` snapshot: the positions of every row it
 *   touched, taken before the change. The Undo toast replays that snapshot
 *   rather than trying to invert the operation, so swap, replace and
 *   move-to-unscheduled all undo through the same path.
 */

const POSITION_FIELDS = 'id, production_date, shift_id, sort_order, deleted_at';

/**
 * Pushed onto the sort_order of cards arriving in a slot, before renumbering.
 *
 * Without it the tie between an arriving card and a resident with the same
 * sort_order breaks on id, so whichever was created first wins - which from the
 * planner's side looks random. Cards that were already in the slot keep their
 * order and arrivals go underneath, which is what "add below" means everywhere
 * else in the app.
 */
const ARRIVAL_OFFSET = 100000;

/** Fields the undo snapshot restores. */
function snapshot(row) {
  return {
    id: row.id,
    production_date: row.production_date,
    shift_id: row.shift_id,
    sort_order: row.sort_order,
    deleted_at: row.deleted_at
  };
}

/**
 * A snapshot that also carries the quantity, for operations that change it.
 *
 * Splitting a card is the only one so far. Kept separate from snapshot() so the
 * common case does not haul quantity around, and so restore can tell the two
 * apart: an older snapshot has no quantity keys and must not have its quantity
 * reset to null on the way back.
 */
function snapshotWithQuantity(row) {
  return {
    ...snapshot(row),
    planned_quantity: row.planned_quantity
  };
}

async function logChange(client, { locationId, entryId, action, summary, before, after, user }) {
  await client.query(
    `INSERT INTO production_change_log
       (location_id, entry_id, action, summary, before_state, after_state, changed_by, changed_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      locationId,
      entryId,
      action,
      summary || null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      user?.id || null,
      user?.name || null
    ]
  );
}

/** Next free sort_order in a slot, so a new card lands at the bottom. */
async function nextSortOrder(client, locationId, productionDate, shiftId) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
       FROM production_plan_entries
      WHERE location_id = $1
        AND production_date IS NOT DISTINCT FROM $2
        AND shift_id IS NOT DISTINCT FROM $3
        AND deleted_at IS NULL`,
    [locationId, productionDate, shiftId]
  );
  return rows[0].next;
}

/** Live cards in a slot, ordered. Excludes `exceptId` so a move ignores itself. */
async function slotOccupants(client, locationId, productionDate, shiftId, exceptId = null) {
  const { rows } = await client.query(
    `SELECT ${POSITION_FIELDS}
       FROM production_plan_entries
      WHERE location_id = $1
        AND production_date IS NOT DISTINCT FROM $2
        AND shift_id IS NOT DISTINCT FROM $3
        AND deleted_at IS NULL
        AND ($4::int IS NULL OR id <> $4)
      ORDER BY sort_order, id`,
    [locationId, productionDate, shiftId, exceptId]
  );
  return rows;
}

class ProductionEntry {
  static get MOVE_MODES() {
    return ['swap', 'add_below', 'replace', 'unschedule_existing'];
  }

  // ------------------------------------------------------------------ create
  static async create(data, user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const sortOrder = await nextSortOrder(
        client, data.locationId, data.productionDate || null, data.shiftId || null
      );

      const { rows } = await client.query(
        `INSERT INTO production_plan_entries
           (location_id, production_date, shift_id, product_id, custom_product_name,
            planned_quantity, priority, color, status, notes,
            due_date, sort_order, created_by, created_by_name, updated_by, updated_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$13,$14)
         RETURNING *`,
        [
          data.locationId,
          data.productionDate || null,
          data.shiftId || null,
          data.productId || null,
          data.customProductName || null,
          data.plannedQuantity ?? null,
          data.priority || 'normal',
          data.color || null,
          data.status || 'planned',
          data.notes || null,
          data.dueDate || null,
          sortOrder,
          user?.id || null,
          user?.name || null
        ]
      );

      const entry = rows[0];
      await logChange(client, {
        locationId: data.locationId,
        entryId: entry.id,
        action: 'created',
        summary: `Added ${data.customProductName || `product #${data.productId}`}`,
        after: snapshot(entry),
        user
      });

      await client.query('COMMIT');
      // Deleting the row it just made is the inverse of creating one.
      return { entry, undo: { deleteIds: [entry.id] } };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ------------------------------------------------------------------ update
  /**
   * Field update with optimistic concurrency: `expectedVersion` must match, so
   * two planners editing the same card cannot silently overwrite each other.
   * Returns null when the version has moved on.
   */
  static async update(id, data, expectedVersion, user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: current } = await client.query(
        'SELECT * FROM production_plan_entries WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [id]
      );
      if (!current[0]) {
        await client.query('ROLLBACK');
        return { notFound: true };
      }
      if (expectedVersion != null && current[0].version !== expectedVersion) {
        await client.query('ROLLBACK');
        return { conflict: true, current: current[0] };
      }

      const before = current[0];
      const { rows } = await client.query(
        `UPDATE production_plan_entries SET
            product_id          = $2,
            custom_product_name = $3,
            planned_quantity    = $4,
            priority            = $5,
            color               = $6,
            status              = $7,
            notes               = $8,
            due_date            = $9,
            version             = version + 1,
            updated_by          = $10,
            updated_by_name     = $11
          WHERE id = $1
          RETURNING *`,
        [
          id,
          data.productId ?? null,
          data.customProductName ?? null,
          data.plannedQuantity ?? null,
          data.priority || 'normal',
          data.color ?? null,
          data.status || 'planned',
          data.notes ?? null,
          data.dueDate ?? null,
          user?.id || null,
          user?.name || null
        ]
      );

      await logChange(client, {
        locationId: before.location_id,
        entryId: id,
        action: 'updated',
        summary: 'Card edited',
        before,
        after: rows[0],
        user
      });

      await client.query('COMMIT');
      return { entry: rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ------------------------------------------------------------------ status
  /**
   * Close a card, or reopen it.
   *
   * Deliberately not version-checked. Everything else on a card is an opinion
   * two planners can hold differently at once; "this was made" is not, and a
   * 409 here would only send a supervisor back to reload and click again.
   * Setting the status it already has is a no-op rather than a fresh log line.
   */
  static async setStatus(id, status, user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: current } = await client.query(
        'SELECT * FROM production_plan_entries WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [id]
      );
      if (!current[0]) {
        await client.query('ROLLBACK');
        return { notFound: true };
      }

      const before = current[0];
      if (before.status === status) {
        await client.query('ROLLBACK');
        return { entry: before };
      }

      const { rows } = await client.query(
        `UPDATE production_plan_entries
            SET status = $2, version = version + 1, updated_by = $3, updated_by_name = $4
          WHERE id = $1
          RETURNING *`,
        [id, status, user?.id || null, user?.name || null]
      );

      await logChange(client, {
        locationId: before.location_id,
        entryId: id,
        action: 'updated',
        summary: status === 'done' ? 'Marked as done' : 'Reopened',
        before,
        after: rows[0],
        user
      });

      await client.query('COMMIT');
      return { entry: rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ------------------------------------------------------------------ delete
  static async softDelete(id, user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: current } = await client.query(
        `SELECT ${POSITION_FIELDS}, location_id FROM production_plan_entries
          WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id]
      );
      if (!current[0]) {
        await client.query('ROLLBACK');
        return { notFound: true };
      }

      await client.query(
        `UPDATE production_plan_entries
            SET deleted_at = CURRENT_TIMESTAMP, version = version + 1,
                updated_by = $2, updated_by_name = $3
          WHERE id = $1`,
        [id, user?.id || null, user?.name || null]
      );

      await logChange(client, {
        locationId: current[0].location_id,
        entryId: id,
        action: 'deleted',
        summary: 'Card removed',
        before: snapshot(current[0]),
        user
      });

      await client.query('COMMIT');
      return { undo: { positions: [snapshot(current[0])] } };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------- move
  /**
   * Move one card to a slot, or to the Unscheduled queue when the target has no
   * date. When the target already holds cards, `mode` decides what happens -
   * and whichever it is, the whole thing is one transaction.
   *
   *   swap                the two cards exchange places
   *   add_below           the card joins the slot underneath what is there
   *   replace             the existing cards are removed
   *   unschedule_existing the existing cards go to the queue
   *
   * Returns { needsDecision, occupants } when the target is occupied and no
   * mode was given, so the UI can ask rather than guess.
   */
  static async move(id, target, mode, user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: moving } = await client.query(
        `SELECT ${POSITION_FIELDS}, location_id FROM production_plan_entries
          WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id]
      );
      if (!moving[0]) {
        await client.query('ROLLBACK');
        return { notFound: true };
      }

      const entry = moving[0];
      const locationId = entry.location_id;
      const toDate = target.productionDate || null;
      const toShift = toDate ? (target.shiftId || null) : null;

      const occupants = await slotOccupants(client, locationId, toDate, toShift, id);

      // An occupied target needs a decision, unless the card is only being
      // reordered inside the slot it already sits in.
      const sameSlot =
        String(entry.production_date) === String(toDate) && entry.shift_id === toShift;

      if (occupants.length > 0 && !mode && !sameSlot && toDate) {
        await client.query('ROLLBACK');
        return { needsDecision: true, occupants };
      }

      const undoPositions = [snapshot(entry), ...occupants.map(snapshot)];

      // Apply the chosen resolution to whatever is already in the target.
      if (occupants.length > 0 && !sameSlot) {
        if (mode === 'swap') {
          // Only a single occupant can swap meaningfully; with several, the
          // rest ride along to the source slot.
          for (const occupant of occupants) {
            await client.query(
              `UPDATE production_plan_entries
                  SET production_date = $2, shift_id = $3, version = version + 1,
                      updated_by = $4, updated_by_name = $5
                WHERE id = $1`,
              [occupant.id, entry.production_date, entry.shift_id, user?.id || null, user?.name || null]
            );
          }
        } else if (mode === 'replace') {
          for (const occupant of occupants) {
            await client.query(
              `UPDATE production_plan_entries
                  SET deleted_at = CURRENT_TIMESTAMP, version = version + 1,
                      updated_by = $2, updated_by_name = $3
                WHERE id = $1`,
              [occupant.id, user?.id || null, user?.name || null]
            );
          }
        } else if (mode === 'unschedule_existing') {
          for (const occupant of occupants) {
            await client.query(
              `UPDATE production_plan_entries
                  SET production_date = NULL, shift_id = NULL, version = version + 1,
                      updated_by = $2, updated_by_name = $3
                WHERE id = $1`,
              [occupant.id, user?.id || null, user?.name || null]
            );
          }
        }
        // add_below leaves the occupants exactly where they are.
      }

      const sortOrder = await nextSortOrder(client, locationId, toDate, toShift);
      const { rows: updated } = await client.query(
        `UPDATE production_plan_entries
            SET production_date = $2, shift_id = $3, sort_order = $4,
                version = version + 1, updated_by = $5, updated_by_name = $6
          WHERE id = $1
          RETURNING *`,
        [id, toDate, toShift, sortOrder, user?.id || null, user?.name || null]
      );

      await logChange(client, {
        locationId,
        entryId: id,
        action: toDate ? 'moved' : 'unscheduled',
        summary: toDate
          ? `Moved to ${toDate}${mode ? ` (${mode})` : ''}`
          : 'Moved to Unscheduled',
        before: snapshot(entry),
        after: snapshot(updated[0]),
        user
      });

      await client.query('COMMIT');
      return { entry: updated[0], undo: { positions: undoPositions } };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------- undo
  /**
   * Put a set of rows back where they were. Replaying a snapshot rather than
   * inverting an operation means one code path undoes every kind of move,
   * including the ones that deleted or unscheduled other cards.
   */
  static async restorePositions(positions, user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const restored = [];
      for (const position of positions) {
        // Only snapshots from an operation that changed the quantity carry it.
        // Restoring one that does not must leave the quantity alone, or undoing
        // a plain move would blank it.
        const hasQuantity = Object.prototype.hasOwnProperty.call(position, 'planned_quantity');

        const { rows } = await client.query(
          hasQuantity
            ? `UPDATE production_plan_entries
                  SET production_date = $2, shift_id = $3, sort_order = $4, deleted_at = $5,
                      planned_quantity = $8,
                      version = version + 1, updated_by = $6, updated_by_name = $7
                WHERE id = $1
                RETURNING *`
            : `UPDATE production_plan_entries
                  SET production_date = $2, shift_id = $3, sort_order = $4, deleted_at = $5,
                      version = version + 1, updated_by = $6, updated_by_name = $7
                WHERE id = $1
                RETURNING *`,
          [
            position.id,
            position.production_date || null,
            position.shift_id || null,
            position.sort_order ?? 0,
            position.deleted_at || null,
            user?.id || null,
            user?.name || null,
            // Snapshots written before migration 029 also carry the retired
            // breakdown columns; the total beside them is what survived, and it
            // is the only part still restorable.
            ...(hasQuantity ? [position.planned_quantity ?? null] : [])
          ]
        );
        if (rows[0]) restored.push(rows[0]);
      }

      if (restored.length > 0) {
        await logChange(client, {
          locationId: restored[0].location_id,
          entryId: restored[0].id,
          action: 'restored',
          summary: `Undo restored ${restored.length} card(s)`,
          after: restored.map(snapshot),
          user
        });
      }

      await client.query('COMMIT');
      return { restored };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Hard-remove rows a create-undo should erase rather than restore. */
  static async hardDelete(ids, user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'DELETE FROM production_plan_entries WHERE id = ANY($1::int[]) RETURNING id, location_id',
        [ids]
      );
      if (rows[0]) {
        await logChange(client, {
          locationId: rows[0].location_id,
          entryId: rows[0].id,
          action: 'deleted',
          summary: 'Undo removed a newly added card',
          user
        });
      }
      await client.query('COMMIT');
      return { removed: rows.map((r) => r.id) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // --------------------------------------------------------------- unscheduled
  static async findUnscheduled(locationId) {
    const { rows } = await pool.query(
      `SELECT e.id, e.location_id, e.product_id, p.fg_number, p.description AS product_description,
              e.custom_product_name, e.planned_quantity,
              e.priority, e.color, e.status, e.notes, e.due_date, e.version, e.updated_at, e.updated_by_name
         FROM production_plan_entries e
         LEFT JOIN products p ON p.id = e.product_id
        WHERE e.location_id = $1
          AND e.production_date IS NULL
          AND e.deleted_at IS NULL
        ORDER BY e.due_date NULLS LAST, e.id`,
      [locationId]
    );
    return rows;
  }

  // ----------------------------------------------------------------- day flags
  static async setDayFlag(locationId, date, flag, note, user) {
    if (!flag) {
      const { rows } = await pool.query(
        `DELETE FROM production_day_flags
          WHERE location_id = $1 AND production_date = $2
          RETURNING *`,
        [locationId, date]
      );
      return { cleared: rows[0] || null };
    }

    const { rows } = await pool.query(
      `INSERT INTO production_day_flags (location_id, production_date, flag, note, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (location_id, production_date)
       DO UPDATE SET flag = EXCLUDED.flag, note = EXCLUDED.note, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [locationId, date, flag, note || null, user?.id || null]
    );
    return { flag: rows[0] };
  }

  // --------------------------------------------------------------- shift notes
  /**
   * The note under one shift on one day (migration 027).
   *
   * Blank clears it - there is no separate delete, because "select the text,
   * delete it, click away" is what people do to remove a note and it would be
   * surprising if that left an empty row behind.
   */
  static async setShiftNote(locationId, date, shiftId, note, user) {
    const text = (note || '').trim();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: existing } = await client.query(
        `SELECT id, note FROM production_shift_notes
          WHERE location_id = $1 AND production_date = $2 AND shift_id = $3`,
        [locationId, date, shiftId]
      );
      const before = existing[0] || null;

      if (!text) {
        if (before) {
          await client.query('DELETE FROM production_shift_notes WHERE id = $1', [before.id]);
          await logChange(client, {
            locationId,
            entryId: null,
            action: 'shift_note_cleared',
            summary: `Note cleared on ${date}`,
            before: { note: before.note, production_date: date, shift_id: shiftId },
            after: null,
            user
          });
        }
        await client.query('COMMIT');
        return { note: null };
      }

      const { rows } = await client.query(
        `INSERT INTO production_shift_notes
           (location_id, production_date, shift_id, note,
            created_by, created_by_name, updated_by, updated_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $5, $6)
         ON CONFLICT (location_id, production_date, shift_id)
         DO UPDATE SET note = EXCLUDED.note,
                       updated_by = EXCLUDED.updated_by,
                       updated_by_name = EXCLUDED.updated_by_name,
                       updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [locationId, date, shiftId, text, user?.id || null, user?.name || null]
      );

      await logChange(client, {
        locationId,
        entryId: null,
        action: 'shift_note_set',
        summary: `Note on ${date}: ${text.slice(0, 80)}`,
        before: before ? { note: before.note, production_date: date, shift_id: shiftId } : null,
        after: { note: text, production_date: date, shift_id: shiftId },
        user
      });

      await client.query('COMMIT');
      return { note: rows[0] };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // ------------------------------------------------------------------- bulk
  /**
   * Move, copy or swap whole days, shift a date range, and split a card.
   *
   * These exist because a plan is rarely rearranged one card at a time. When a
   * day falls out, everything after it slides - doing that by dragging thirty
   * cards is how people end up back in Excel.
   *
   * All of them go through the same two rules as a single move: one
   * transaction, and an undo snapshot taken before anything changes.
   */

  /** Live entries on one day, whatever shift. */
  static async _dayEntries(client, locationId, date) {
    const { rows } = await client.query(
      `SELECT ${POSITION_FIELDS}
         FROM production_plan_entries
        WHERE location_id = $1 AND production_date = $2 AND deleted_at IS NULL
        ORDER BY shift_id, sort_order, id`,
      [locationId, date]
    );
    return rows;
  }

  /**
   * Renumber sort_order within every slot in a range, so cards that arrive from
   * elsewhere land in a defined order rather than sharing a number with what
   * was already there.
   */
  static async _renumber(client, locationId, fromDate, toDate) {
    await client.query(
      `WITH ordered AS (
         SELECT id,
                ROW_NUMBER() OVER (PARTITION BY production_date, shift_id
                                   ORDER BY sort_order, id) - 1 AS rn
           FROM production_plan_entries
          WHERE location_id = $1
            AND production_date BETWEEN $2 AND $3
            AND deleted_at IS NULL
       )
       UPDATE production_plan_entries e
          SET sort_order = o.rn
         FROM ordered o
        WHERE e.id = o.id AND e.sort_order <> o.rn`,
      [locationId, fromDate, toDate]
    );
  }

  /** Soft-delete everything on a day. Used by the "replace" modes. */
  static async _clearDay(client, locationId, date, user) {
    const existing = await ProductionEntry._dayEntries(client, locationId, date);
    if (existing.length) {
      await client.query(
        `UPDATE production_plan_entries
            SET deleted_at = CURRENT_TIMESTAMP, version = version + 1,
                updated_by = $2, updated_by_name = $3
          WHERE id = ANY($1::int[])`,
        [existing.map((e) => e.id), user?.id || null, user?.name || null]
      );
    }
    return existing;
  }

  /**
   * Move every card from one day to another, keeping each card's shift.
   *
   * mode 'merge'   the cards join whatever is already on the target day
   *      'replace' the target day is cleared first
   */
  static async moveDay(locationId, fromDate, toDate, mode, user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const moving = await ProductionEntry._dayEntries(client, locationId, fromDate);
      if (!moving.length) {
        await client.query('ROLLBACK');
        return { empty: true };
      }

      const undoPositions = moving.map(snapshot);

      if (mode === 'replace') {
        const cleared = await ProductionEntry._clearDay(client, locationId, toDate, user);
        undoPositions.push(...cleared.map(snapshot));
      }

      await client.query(
        `UPDATE production_plan_entries
            SET production_date = $2, sort_order = sort_order + ${ARRIVAL_OFFSET},
                version = version + 1, updated_by = $3, updated_by_name = $4
          WHERE id = ANY($1::int[])`,
        [moving.map((e) => e.id), toDate, user?.id || null, user?.name || null]
      );

      await ProductionEntry._renumber(client, locationId, toDate, toDate);

      await logChange(client, {
        locationId,
        entryId: moving[0].id,
        action: 'moved',
        summary: `Moved ${moving.length} card(s) from ${fromDate} to ${toDate}`,
        before: undoPositions,
        user
      });

      await client.query('COMMIT');
      return { moved: moving.length, undo: { positions: undoPositions } };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Exchange two whole days, both shifts included. */
  static async swapDays(locationId, dateA, dateB, user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const a = await ProductionEntry._dayEntries(client, locationId, dateA);
      const b = await ProductionEntry._dayEntries(client, locationId, dateB);

      if (!a.length && !b.length) {
        await client.query('ROLLBACK');
        return { empty: true };
      }

      const undoPositions = [...a, ...b].map(snapshot);

      // Two updates by explicit id list, so neither can pick up rows the other
      // just moved.
      if (a.length) {
        await client.query(
          `UPDATE production_plan_entries SET production_date = $2, version = version + 1,
                  updated_by = $3, updated_by_name = $4
            WHERE id = ANY($1::int[])`,
          [a.map((e) => e.id), dateB, user?.id || null, user?.name || null]
        );
      }
      if (b.length) {
        await client.query(
          `UPDATE production_plan_entries SET production_date = $2, version = version + 1,
                  updated_by = $3, updated_by_name = $4
            WHERE id = ANY($1::int[])`,
          [b.map((e) => e.id), dateA, user?.id || null, user?.name || null]
        );
      }

      await logChange(client, {
        locationId,
        entryId: (a[0] || b[0]).id,
        action: 'moved',
        summary: `Swapped ${dateA} (${a.length} cards) with ${dateB} (${b.length} cards)`,
        before: undoPositions,
        user
      });

      await client.query('COMMIT');
      return { swapped: a.length + b.length, undo: { positions: undoPositions } };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Shift everything in a date range by a number of days.
   *
   * The reason this exists: a day falls out and the rest of the week has to
   * slide. One statement moves the whole range, so nothing can collide with
   * itself part-way through.
   */
  static async shiftRange(locationId, fromDate, toDate, days, user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: affected } = await client.query(
        `SELECT ${POSITION_FIELDS}
           FROM production_plan_entries
          WHERE location_id = $1
            AND production_date BETWEEN $2 AND $3
            AND deleted_at IS NULL`,
        [locationId, fromDate, toDate]
      );

      if (!affected.length) {
        await client.query('ROLLBACK');
        return { empty: true };
      }

      const undoPositions = affected.map(snapshot);

      await client.query(
        `UPDATE production_plan_entries
            SET production_date = production_date + ($2 || ' days')::interval,
                sort_order = sort_order + ${ARRIVAL_OFFSET},
                version = version + 1, updated_by = $3, updated_by_name = $4
          WHERE id = ANY($1::int[])`,
        [affected.map((e) => e.id), days, user?.id || null, user?.name || null]
      );

      // Renumber across both the old and the new footprint, since cards may
      // have landed on days that already held production.
      await ProductionEntry._renumber(client, locationId, fromDate, toDate);
      const shiftedFrom = new Date(fromDate);
      shiftedFrom.setDate(shiftedFrom.getDate() + days);
      const shiftedTo = new Date(toDate);
      shiftedTo.setDate(shiftedTo.getDate() + days);
      await ProductionEntry._renumber(
        client,
        locationId,
        shiftedFrom.toISOString().slice(0, 10),
        shiftedTo.toISOString().slice(0, 10)
      );

      await logChange(client, {
        locationId,
        entryId: affected[0].id,
        action: 'moved',
        summary: `Shifted ${affected.length} card(s) in ${fromDate}..${toDate} by ${days > 0 ? '+' : ''}${days} day(s)`,
        before: undoPositions,
        user
      });

      await client.query('COMMIT');
      return { shifted: affected.length, undo: { positions: undoPositions } };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Copy a run of days onto another start date. One day for "copy day", seven
   * for "copy week" - the same operation either way.
   *
   * Copies are new cards, so undoing means deleting them rather than moving
   * anything back.
   */
  static async copyDays(locationId, fromDate, toDate, dayCount, mode, user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const from = new Date(fromDate);
      const to = new Date(toDate);
      const createdIds = [];
      const clearedPositions = [];
      let sourceCount = 0;

      for (let offset = 0; offset < dayCount; offset++) {
        const sourceDate = new Date(from);
        sourceDate.setDate(from.getDate() + offset);
        const targetDate = new Date(to);
        targetDate.setDate(to.getDate() + offset);

        const sourceIso = sourceDate.toISOString().slice(0, 10);
        const targetIso = targetDate.toISOString().slice(0, 10);

        if (mode === 'replace') {
          const cleared = await ProductionEntry._clearDay(client, locationId, targetIso, user);
          clearedPositions.push(...cleared.map(snapshot));
        }

        // Copy the plan, not its history: source cell references, timestamps and
        // authorship belong to the original.
        const { rows } = await client.query(
          `INSERT INTO production_plan_entries
             (location_id, production_date, shift_id, product_id, custom_product_name,
              planned_quantity, priority, color, status, notes,
              sort_order, created_by, created_by_name, updated_by, updated_by_name)
           SELECT location_id, $3::date, shift_id, product_id, custom_product_name,
                  planned_quantity, priority, color, 'planned', notes,
                  sort_order + ${ARRIVAL_OFFSET}, $4, $5, $4, $5
             FROM production_plan_entries
            WHERE location_id = $1 AND production_date = $2 AND deleted_at IS NULL
           RETURNING id`,
          [locationId, sourceIso, targetIso, user?.id || null, user?.name || null]
        );

        createdIds.push(...rows.map((r) => r.id));
        sourceCount += rows.length;
      }

      if (!sourceCount) {
        await client.query('ROLLBACK');
        return { empty: true };
      }

      const lastTarget = new Date(to);
      lastTarget.setDate(to.getDate() + dayCount - 1);
      await ProductionEntry._renumber(client, locationId, toDate, lastTarget.toISOString().slice(0, 10));

      await logChange(client, {
        locationId,
        entryId: createdIds[0],
        action: 'created',
        summary: `Copied ${sourceCount} card(s) from ${fromDate} to ${toDate}`,
        after: { createdIds },
        user
      });

      await client.query('COMMIT');
      return {
        copied: sourceCount,
        // Undo removes the copies and puts back anything "replace" cleared.
        undo: { deleteIds: createdIds, positions: clearedPositions }
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Split a card's quantity across two slots.
   *
   * The original keeps `keepQuantity`; the remainder becomes a new card on the
   * target date and shift. Undo restores the original quantity and removes the
   * new card, which is why the snapshot here carries quantity.
   */
  static async splitQuantity(id, keepQuantity, target, user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: current } = await client.query(
        'SELECT * FROM production_plan_entries WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [id]
      );
      if (!current[0]) {
        await client.query('ROLLBACK');
        return { notFound: true };
      }

      const entry = current[0];
      const total = Number(entry.planned_quantity);
      if (!Number.isFinite(total) || total <= 0) {
        await client.query('ROLLBACK');
        return { notSplittable: true };
      }
      if (!(keepQuantity > 0) || keepQuantity >= total) {
        await client.query('ROLLBACK');
        return { badSplit: true, total };
      }

      const remainder = total - keepQuantity;
      const undoSnapshot = snapshotWithQuantity(entry);

      await client.query(
        `UPDATE production_plan_entries
            SET planned_quantity = $2,
                version = version + 1, updated_by = $3, updated_by_name = $4
          WHERE id = $1`,
        [id, keepQuantity, user?.id || null, user?.name || null]
      );

      const targetDate = target.productionDate || entry.production_date;
      const targetShift = target.shiftId ?? entry.shift_id;
      const sortOrder = await nextSortOrder(client, entry.location_id, targetDate, targetShift);

      const { rows: created } = await client.query(
        `INSERT INTO production_plan_entries
           (location_id, production_date, shift_id, product_id, custom_product_name,
            planned_quantity, priority, color, status, notes, sort_order,
            created_by, created_by_name, updated_by, updated_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'planned',$9,$10,$11,$12,$11,$12)
         RETURNING *`,
        [
          entry.location_id,
          targetDate,
          targetShift,
          entry.product_id,
          entry.custom_product_name,
          remainder,
          entry.priority,
          entry.color,
          entry.notes,
          sortOrder,
          user?.id || null,
          user?.name || null
        ]
      );

      await logChange(client, {
        locationId: entry.location_id,
        entryId: id,
        action: 'updated',
        summary: `Split ${total} into ${keepQuantity} + ${remainder}`,
        before: undoSnapshot,
        after: snapshot(created[0]),
        user
      });

      await client.query('COMMIT');
      return {
        entry: created[0],
        undo: { positions: [undoSnapshot], deleteIds: [created[0].id] }
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ------------------------------------------------------------------ history
  /**
   * Recent changes for a location, newest first.
   *
   * Joined against the entry as it stands now, so the UI can tell the
   * difference between "this was deleted and is still gone" - which can be put
   * back - and "this was deleted and someone has already restored it".
   */
  static async findActivity(locationId, { limit = 50, before = null, entryId = null } = {}) {
    const { rows } = await pool.query(
      `SELECT l.id, l.entry_id, l.action, l.summary, l.before_state, l.after_state,
              l.changed_by_name, l.changed_at,
              e.id IS NOT NULL              AS entry_exists,
              e.deleted_at IS NOT NULL      AS entry_deleted,
              e.production_date             AS entry_date,
              COALESCE(p.fg_number, e.custom_product_name) AS entry_label
         FROM production_change_log l
         LEFT JOIN production_plan_entries e ON e.id = l.entry_id
         LEFT JOIN products p                ON p.id = e.product_id
        WHERE l.location_id = $1
          AND ($2::int IS NULL OR l.entry_id = $2)
          -- Keyset rather than OFFSET: the log only grows, and paging by id
          -- stays correct even as new rows land at the top while reading.
          AND ($3::bigint IS NULL OR l.id < $3)
        ORDER BY l.id DESC
        LIMIT $4`,
      [locationId, entryId, before, Math.min(Number(limit) || 50, 200)]
    );
    return rows;
  }

  /**
   * Put an entry back to the state a log row recorded before that change.
   *
   * This is what makes a deletion recoverable long after the Undo toast has
   * gone: the log keeps the position, so restoring is the same replay Undo
   * uses. Restoring is itself logged - the log is append-only, so undoing
   * something never erases the record that it happened.
   */
  static async restoreFromLog(logId, user) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: logRows } = await client.query(
        'SELECT * FROM production_change_log WHERE id = $1',
        [logId]
      );
      const entry = logRows[0];
      if (!entry) {
        await client.query('ROLLBACK');
        return { notFound: true };
      }

      const before = entry.before_state;
      if (!before || !before.id) {
        await client.query('ROLLBACK');
        return { notRestorable: true };
      }

      const { rows: updated } = await client.query(
        `UPDATE production_plan_entries
            SET production_date = $2, shift_id = $3, sort_order = $4, deleted_at = $5,
                version = version + 1, updated_by = $6, updated_by_name = $7
          WHERE id = $1
          RETURNING *`,
        [
          before.id,
          before.production_date || null,
          before.shift_id || null,
          before.sort_order ?? 0,
          before.deleted_at || null,
          user?.id || null,
          user?.name || null
        ]
      );

      if (!updated[0]) {
        // The row was hard-deleted; the log remains but there is nothing left
        // to put back.
        await client.query('ROLLBACK');
        return { gone: true };
      }

      await logChange(client, {
        locationId: entry.location_id,
        entryId: before.id,
        action: 'restored',
        summary: `Restored from history (${entry.action} on ${new Date(entry.changed_at).toISOString().slice(0, 10)})`,
        after: snapshot(updated[0]),
        user
      });

      await client.query('COMMIT');
      return { entry: updated[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Find or create an FG so a card can reference a number typed by hand. */
  static async findOrCreateProduct(fgNumber, description) {
    const { rows } = await pool.query(
      `INSERT INTO products (fg_number, description)
       VALUES ($1, $2)
       ON CONFLICT (fg_number) DO UPDATE
         SET description = COALESCE(products.description, EXCLUDED.description)
       RETURNING *`,
      [fgNumber, description || null]
    );
    return rows[0];
  }

  /**
   * Correct an FG's description.
   *
   * The master list came out of Excel, where a wrong or missing description
   * stayed wrong forever. It belongs to the FG, so this shows up on every card
   * carrying that number - which is the behaviour a planner expects when they
   * fix a product name.
   */
  static async setProductDescription(id, description) {
    const { rows } = await pool.query(
      'UPDATE products SET description = $2 WHERE id = $1 RETURNING *',
      [id, description]
    );
    return rows[0] || null;
  }
}

module.exports = ProductionEntry;
