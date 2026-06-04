const pool = require('../config');
const { v4: uuidv4 } = require('uuid');

class Ticket {
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
    const query = 'SELECT * FROM tickets WHERE ticket_id = $1';
    const result = await pool.query(query, [ticketId]);
    return result.rows[0];
  }

  /**
   * Get all tickets (with optional filters)
   */
  static async findAll(filters = {}) {
    let query = `SELECT t.*, COALESCE(ac.cnt, 0)::int AS attachment_count
      FROM tickets t
      LEFT JOIN (SELECT ticket_id, COUNT(*) AS cnt FROM ticket_attachments GROUP BY ticket_id) ac
        ON ac.ticket_id = t.ticket_id
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
      await this.logAction(ticketId, 'AdminEdit', performedBy, JSON.stringify(Object.keys(fields)));
    }

    return result.rows[0];
  }

  /**
   * Update ticket status
   */
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
