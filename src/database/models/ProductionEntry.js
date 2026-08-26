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
            planned_quantity, quantity_breakdown, raw_quantity, priority, status, notes,
            due_date, sort_order, created_by, created_by_name, updated_by, updated_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$14,$15)
         RETURNING *`,
        [
          data.locationId,
          data.productionDate || null,
          data.shiftId || null,
          data.productId || null,
          data.customProductName || null,
          data.plannedQuantity ?? null,
          data.quantityBreakdown ? JSON.stringify(data.quantityBreakdown) : null,
          data.rawQuantity || null,
          data.priority || 'normal',
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
            quantity_breakdown  = $5,
            raw_quantity        = $6,
            priority            = $7,
            status              = $8,
            notes               = $9,
            due_date            = $10,
            version             = version + 1,
            updated_by          = $11,
            updated_by_name     = $12
          WHERE id = $1
          RETURNING *`,
        [
          id,
          data.productId ?? null,
          data.customProductName ?? null,
          data.plannedQuantity ?? null,
          data.quantityBreakdown ? JSON.stringify(data.quantityBreakdown) : null,
          data.rawQuantity ?? null,
          data.priority || 'normal',
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
        before: { ...before, quantity_breakdown: before.quantity_breakdown },
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
        const { rows } = await client.query(
          `UPDATE production_plan_entries
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
            user?.name || null
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
              e.custom_product_name, e.planned_quantity, e.quantity_breakdown, e.raw_quantity,
              e.priority, e.status, e.notes, e.due_date, e.version, e.updated_at, e.updated_by_name
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
}

module.exports = ProductionEntry;
