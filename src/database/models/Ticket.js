const pool = require('../config');
const { v4: uuidv4 } = require('uuid');

/**
 * Spracoval už PAM túto žiadosť?
 *
 * Vráti 'processed', 'pending', alebo NULL - a to NULL je tu rovnako
 * dôležité ako tie dve hodnoty. Znamená „na túto žiadosť sa otázka
 * nevzťahuje" a štítok sa vtedy nemá ukázať vôbec: pri neschválených, pri
 * typoch bez kvóty (nákup, výdavok), a hlavne pri ľuďoch, ktorí na PAM
 * napojení nie sú. Tým appka kvótu odpočítava sama, takže niet na čo čakať
 * a štítok „Nespracované" by im len klamal.
 *
 * Hranicou je posledný mesiac, za ktorý má PAM spracované mzdy. Nie je to
 * dokonalé - PAM nevie povedať „túto konkrétnu žiadosť som započítal" -
 * ale je to najpresnejšie, čo sa z jeho dát dá zistiť, a dá sa to
 * vysvetliť jednou vetou: mzdy sú spracované do augusta, tvoja žiadosť je
 * zo septembra.
 */
const PAM_STATE_SQL = `
  CASE
    WHEN t.status <> 'Approved' THEN NULL
    WHEN t.ticket_type NOT IN ('vacation', 'paragraph', 'ocr') THEN NULL
    WHEN t.start_date IS NULL THEN NULL
    WHEN COALESCE(pu.is_external, FALSE) OR pu.personal_number IS NULL
      OR pq.pam_synced_at IS NULL THEN NULL
    WHEN EXTRACT(MONTH FROM t.start_date) <= COALESCE(pq.pam_last_month, 0) THEN 'processed'
    ELSE 'pending'
  END`;

const PAM_STATE_JOINS = `
  LEFT JOIN users pu ON pu.user_id = t.created_by_id
  LEFT JOIN employee_quotas pq
         ON pq.user_id = t.created_by_id
        AND pq.year = EXTRACT(YEAR FROM t.start_date)::int`;

class Ticket {
  static get PAM_STATE_SQL() { return PAM_STATE_SQL; }
  static get PAM_STATE_JOINS() { return PAM_STATE_JOINS; }

  /**
   * Create a new ticket
   */
  static async create(ticketData) {
    const ticketId = `TKT-${uuidv4().split('-')[0].toUpperCase()}`;

    const query = `
      INSERT INTO tickets (
        ticket_id, title, description, ticket_type, priority,
        created_by_id, created_by_name, created_by_email,
        assigned_approver_id, assigned_approver_name, assigned_approver_email,
        conversation_id, activity_id, start_date, end_date, is_half_day
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;

    const values = [
      ticketId,
      ticketData.title,
      ticketData.description,
      ticketData.ticketType || 'Other',
      ticketData.priority || 'Medium',
      ticketData.createdBy.id,
      ticketData.createdBy.name,
      ticketData.createdBy.email,
      ticketData.assignedApprover?.id,
      ticketData.assignedApprover?.name,
      ticketData.assignedApprover?.email,
      ticketData.conversationId,
      ticketData.activityId,
      ticketData.startDate || null,
      ticketData.endDate || null,
      ticketData.isHalfDay || false
    ];

    const result = await pool.query(query, values);

    // Log the creation action
    await this.logAction(ticketId, 'Created', ticketData.createdBy);

    return result.rows[0];
  }

  /**
   * Get ticket by ID
   */
  static async findById(ticketId) {
    const query = `SELECT t.*, ${Ticket.PAM_STATE_SQL} AS pam_state
                     FROM tickets t ${Ticket.PAM_STATE_JOINS}
                    WHERE t.ticket_id = $1`;
    const result = await pool.query(query, [ticketId]);
    return result.rows[0];
  }

  /**
   * Get all tickets (with optional filters)
   */
  static async findAll(filters = {}) {
    let query = `SELECT t.*, COALESCE(ac.cnt, 0)::int AS attachment_count,
      ${Ticket.PAM_STATE_SQL} AS pam_state
      FROM tickets t
      LEFT JOIN (SELECT ticket_id, COUNT(*) AS cnt FROM ticket_attachments GROUP BY ticket_id) ac
        ON ac.ticket_id = t.ticket_id
      ${Ticket.PAM_STATE_JOINS}
      WHERE 1=1`;
    const values = [];
    let paramCount = 1;

    if (filters.status) {
      query += ` AND t.status = $${paramCount}`;
      values.push(filters.status);
      paramCount++;
    }

    if (filters.createdById) {
      query += ` AND t.created_by_id = $${paramCount}`;
      values.push(filters.createdById);
      paramCount++;
    }

    if (filters.assignedApproverId) {
      query += ` AND t.assigned_approver_id = $${paramCount}`;
      values.push(filters.assignedApproverId);
      paramCount++;
    }

    query += ' ORDER BY t.created_at DESC';

    const result = await pool.query(query, values);
    return result.rows;
  }

  /**
   * Admin edit: update arbitrary ticket fields (admin-only)
   * Returns updated ticket row.
   */
  static async adminUpdate(ticketId, fields, performedBy) {
    const allowed = [
      'title', 'description', 'ticket_type', 'priority', 'status',
      'start_date', 'end_date', 'is_half_day',
      'rejection_reason', 'cancellation_reason',
      'assigned_approver_id', 'assigned_approver_name', 'assigned_approver_email'
    ];

    const sets = [];
    const values = [];
    let i = 1;

    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        sets.push(`${key} = $${i}`);
        values.push(fields[key]);
        i++;
      }
    }

    if (sets.length === 0) {
      return await this.findById(ticketId);
    }

    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(ticketId);

    const query = `UPDATE tickets SET ${sets.join(', ')} WHERE ticket_id = $${i} RETURNING *`;
    const result = await pool.query(query, values);

    if (result.rows[0] && performedBy) {
      await this.logAction(ticketId, 'Updated', performedBy, JSON.stringify(Object.keys(fields)));
    }

    return result.rows[0];
  }

  /**
   * Update ticket status
   */
  /**
   * Koľko žiadosť stojí na kvóte: dni pri dovolenke, hodiny pri paragrafoch.
   *
   * Appka to doteraz vypočítala pri schválení, odpočítala a zahodila.
   * Odteraz si to pamätá - z toho sa sčíta, čo je schválené a PAM to ešte
   * nespracoval, a podľa toho sa pri žiadosti ukazuje Spracované alebo
   * Nespracované.
   */
  static async setQuotaAmount(ticketId, amount) {
    const result = await pool.query(
      'UPDATE tickets SET quota_amount = $1 WHERE ticket_id = $2 RETURNING quota_amount',
      [amount, ticketId]
    );
    return result.rows[0];
  }

  static async updateStatus(ticketId, status, performedBy, reason = null) {
    let query, values;

    if (status === 'Rejected') {
      query = `UPDATE tickets SET status = $1, rejection_reason = $2, updated_at = CURRENT_TIMESTAMP WHERE ticket_id = $3 RETURNING *`;
      values = [status, reason, ticketId];
    } else if (status === 'Cancelled') {
      query = `UPDATE tickets SET status = $1, cancellation_reason = $2, updated_at = CURRENT_TIMESTAMP WHERE ticket_id = $3 RETURNING *`;
      values = [status, reason, ticketId];
    } else {
      query = `UPDATE tickets SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE ticket_id = $2 RETURNING *`;
      values = [status, ticketId];
    }

    const result = await pool.query(query, values);

    // Log the action
    await this.logAction(ticketId, status, performedBy, reason);

    return result.rows[0];
  }

  /**
   * Update conversation/activity IDs for adaptive card
   */
  static async updateConversationInfo(ticketId, conversationId, activityId) {
    const query = `
      UPDATE tickets
      SET conversation_id = $1, activity_id = $2
      WHERE ticket_id = $3
      RETURNING *
    `;

    const result = await pool.query(query, [conversationId, activityId, ticketId]);
    return result.rows[0];
  }

  /**
   * Log ticket action (audit trail)
   */
  static async logAction(ticketId, action, performedBy, rejectionReason = null) {
    const query = `
      INSERT INTO ticket_actions (
        ticket_id, action, performed_by_id, performed_by_name,
        performed_by_email, rejection_reason
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const values = [
      ticketId,
      action,
      performedBy.id,
      performedBy.name,
      performedBy.email,
      rejectionReason
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get all actions for a ticket (audit log)
   */
  static async getActions(ticketId) {
    const query = `
      SELECT * FROM ticket_actions
      WHERE ticket_id = $1
      ORDER BY timestamp DESC
    `;

    const result = await pool.query(query, [ticketId]);
    return result.rows;
  }

  /**
   * Get approvals performed by a user
   */
  static async findApprovalsByUserId(userId) {
    const result = await pool.query(
      `SELECT
         t.*,
         a.action,
         a.rejection_reason AS action_rejection_reason,
         a.timestamp AS action_timestamp,
         COALESCE(ac.cnt, 0)::int AS attachment_count
       FROM ticket_actions a
       JOIN tickets t ON t.ticket_id = a.ticket_id
       LEFT JOIN (SELECT ticket_id, COUNT(*) AS cnt FROM ticket_attachments GROUP BY ticket_id) ac
         ON ac.ticket_id = t.ticket_id
       WHERE a.performed_by_id = $1
         AND a.action IN ('Approved', 'Rejected')
       ORDER BY a.timestamp DESC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Delete a ticket (for testing purposes)
   */
  static async delete(ticketId) {
    const query = 'DELETE FROM tickets WHERE ticket_id = $1';
    await pool.query(query, [ticketId]);
  }
}

module.exports = Ticket;
