const pool = require('../config');

/**
 * Vyskladnenie tovaru majstrom výroby.
 *
 * Pravidlá, ktoré tu platia a nikde inde v module:
 *
 *   * Hľadá sa výhradne v evidencii. Do SAPu sa nechodí ani sem, ani nikam
 *     inam - a už vôbec sa doň nič nezapisuje.
 *   * Odpočítava sa z konkrétnej pozície, nie z materiálu ako celku. Materiál
 *     rozdelený na tri palety nie je jedno číslo, sú to tri miesta v hale.
 *   * Vlastné položky (tašky, police) sa nezmenšujú. Ich počet je poznámka
 *     skladníka - "1 ks" pri hromade tašiek - a odpočítavať od čísla, ktoré
 *     nikto nerátal, by z poznámky spravilo nepravdu. Výdaj sa zapíše, počet
 *     zostane.
 *   * Nič sa nemaže. Storno je zmena stavu a vrátenie počtu, nie zmiznutý
 *     riadok.
 */

const LIST_SELECT = `
  SELECT w.*,
         m.deleted_at IS NULL AND m.id IS NOT NULL AS material_exists,
         m.kind AS material_kind
    FROM warehouse_withdrawals w
    LEFT JOIN materials m ON m.id = w.material_id`;

class WarehouseWithdrawal {
  /**
   * Materiály, z ktorých sa dá vyskladniť.
   *
   * Hľadá sa podľa kódu, názvu aj FG čísla projektu - vlastné položky kód
   * nemajú, takže "tašky" alebo číslo projektu je jediné, čím sa dajú nájsť.
   * Materiál bez pozície sa nevracia: nedá sa vziať z miesta, ktoré nikto
   * nezadal.
   */
  static async search(query, limit = 8) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];

    const { rows } = await pool.query(
      `SELECT m.id, m.code, m.name, m.kind, m.unit, m.quantity, m.project_fg,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'location_id', mp.location_id,
                  'location_code', pl.code,
                  -- Zóna a číslo sú kľúč do mapy skladu: podľa nich sa na nej
                  -- rozsvieti práve tá paleta, ku ktorej má majster ísť.
                  'zone', pl.zone,
                  'position', pl.position,
                  'quantity', mp.quantity
                ) ORDER BY pl.code)
                FROM material_placements mp
                JOIN pallet_locations pl ON pl.id = mp.location_id
                WHERE mp.material_id = m.id
              ), '[]'::json) AS placements
         FROM materials m
        WHERE m.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM material_placements mp2 WHERE mp2.material_id = m.id)
          AND (m.code ILIKE $1 OR m.name ILIKE $1 OR m.project_fg ILIKE $1 OR m.legacy_code ILIKE $1)
        ORDER BY
          -- Presný kód patrí navrch: kto ho odpísal z etikety, hľadá práve ten.
          CASE WHEN lower(m.code) = lower($2) THEN 0 ELSE 1 END,
          m.code NULLS LAST, m.name
        LIMIT $3`,
      [`%${q}%`, q, limit]
    );
    return rows;
  }

  /**
   * Zápis výdaja.
   *
   * Celé v jednej transakcii a s `FOR UPDATE` na pozícii: dvaja majstri pri
   * dvoch tabletoch nesmú z tej istej palety odpísať to isté množstvo dvakrát.
   */
  static async create({ materialId, locationId, quantity, user }) {
    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty <= 0) return { error: 'bad_quantity' };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: mrows } = await client.query(
        `SELECT id, code, name, kind, unit FROM materials
          WHERE id = $1 AND deleted_at IS NULL`,
        [materialId]
      );
      const material = mrows[0];
      if (!material) { await client.query('ROLLBACK'); return { error: 'material_not_found' }; }

      const { rows: prows } = await client.query(
        `SELECT mp.id, mp.quantity, pl.code AS location_code
           FROM material_placements mp
           JOIN pallet_locations pl ON pl.id = mp.location_id
          WHERE mp.material_id = $1 AND mp.location_id = $2
          FOR UPDATE OF mp`,
        [materialId, locationId]
      );
      const placement = prows[0];
      if (!placement) { await client.query('ROLLBACK'); return { error: 'placement_not_found' }; }

      // Vlastná položka: počet je poznámka, nie stav skladu. Zapíšeme výdaj a
      // čísla necháme tak, ako ich zadal skladník.
      const touch = material.kind !== 'local';
      const before = placement.quantity;

      if (touch && qty > before) {
        await client.query('ROLLBACK');
        return { error: 'not_enough', available: before };
      }

      const after = touch ? before - qty : before;

      if (touch) {
        await client.query(
          'UPDATE material_placements SET quantity = $2 WHERE id = $1',
          [placement.id, after]
        );
        // `materials.quantity` je súčet pozícií, takže musí klesnúť s nimi.
        await client.query(
          `UPDATE materials
              SET quantity = (SELECT COALESCE(SUM(quantity), 0)
                                FROM material_placements WHERE material_id = $1),
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [materialId]
        );
      }

      const { rows: wrows } = await client.query(
        `INSERT INTO warehouse_withdrawals
           (material_id, location_id, material_code, material_name, location_code,
            quantity, quantity_before, quantity_after, quantity_touched,
            created_by, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          materialId, locationId, material.code, material.name, placement.location_code,
          qty, before, after, touch,
          user?.id || null, user?.name || null
        ]
      );

      await client.query('COMMIT');
      return { withdrawal: wrows[0], material, unit: material.unit || 'ks' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Storno.
   *
   * Vracia sa presne to, čo sa odpísalo, na pozíciu, z ktorej sa to odpísalo.
   * Ak tá pozícia už neexistuje - materiál sa medzitým presunul alebo prepísal -
   * storno sa odmietne a povie prečo. Domyslieť si, kam to patrí, by znamenalo
   * pripísať počet na miesto, kde ten tovar nikto nevidel.
   */
  static async void(id, user, reason) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        'SELECT * FROM warehouse_withdrawals WHERE id = $1 FOR UPDATE',
        [id]
      );
      const w = rows[0];
      if (!w) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
      if (w.status === 'voided') { await client.query('ROLLBACK'); return { error: 'already_voided' }; }

      if (w.quantity_touched) {
        const { rows: prows } = await client.query(
          `SELECT id FROM material_placements
            WHERE material_id = $1 AND location_id = $2 FOR UPDATE`,
          [w.material_id, w.location_id]
        );
        if (!prows[0]) { await client.query('ROLLBACK'); return { error: 'placement_gone' }; }

        await client.query(
          'UPDATE material_placements SET quantity = quantity + $2 WHERE id = $1',
          [prows[0].id, w.quantity]
        );
        await client.query(
          `UPDATE materials
              SET quantity = (SELECT COALESCE(SUM(quantity), 0)
                                FROM material_placements WHERE material_id = $1),
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [w.material_id]
        );
      }

      const { rows: urows } = await client.query(
        `UPDATE warehouse_withdrawals
            SET status = 'voided', voided_at = CURRENT_TIMESTAMP,
                voided_by = $2, voided_by_name = $3, voided_reason = $4
          WHERE id = $1 RETURNING *`,
        [id, user?.id || null, user?.name || null, reason || null]
      );

      await client.query('COMMIT');
      return { withdrawal: urows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** História. Filtre sú tie, na ktoré sa skladník reálne pýta. */
  static async findAll({ search = null, status = null, from = null, to = null, limit = 300 } = {}) {
    const values = [];
    const where = [];

    if (search) {
      values.push(`%${search}%`);
      const i = values.length;
      where.push(`(w.material_code ILIKE $${i} OR w.material_name ILIKE $${i} OR w.location_code ILIKE $${i})`);
    }
    if (status) { values.push(status); where.push(`w.status = $${values.length}`); }
    if (from) { values.push(from); where.push(`w.created_at >= $${values.length}`); }
    // Dátum "do" vrátane celého dňa; inak by filter na dnešok nenašiel nič.
    if (to) { values.push(to); where.push(`w.created_at < ($${values.length}::date + 1)`); }

    values.push(limit);
    const { rows } = await pool.query(
      `${LIST_SELECT}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY w.created_at DESC
        LIMIT $${values.length}`,
      values
    );
    return rows;
  }

  /**
   * Čo pribudlo od poslednej návštevy skladníka.
   *
   * Zámerne nie "čo treba vybaviť" - to hovorí oranžový semafor pri materiáli.
   * Toto je oznam, nie zoznam práce, a preto sa dá odkliknúť.
   */
  static async newSince(userId) {
    const { rows } = await pool.query(
      `SELECT w.id, w.material_code, w.material_name, w.location_code, w.quantity, w.created_at
         FROM warehouse_withdrawals w
        WHERE w.status = 'active'
          AND w.created_at > COALESCE(
                (SELECT withdrawals_seen_at FROM users WHERE user_id = $1),
                TIMESTAMP '-infinity')
        ORDER BY w.created_at DESC
        LIMIT 20`,
      [userId]
    );
    return rows;
  }

  static async markSeen(userId) {
    await pool.query(
      'UPDATE users SET withdrawals_seen_at = CURRENT_TIMESTAMP WHERE user_id = $1',
      [userId]
    );
  }
}

module.exports = WarehouseWithdrawal;
