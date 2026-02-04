const pool = require('../config');

class TicketAttachment {
  /**
   * Create attachment records for a ticket
   */
  static async createMany(ticketId, files, uploadedBy) {
    if (!files || files.length === 0) return [];

    const values = [];
    const placeholders = files.map((file, idx) => {
      const baseIndex = idx * 8;
      values.push(
        ticketId,
        uploadedBy?.id || null,
        uploadedBy?.name || null,
        uploadedBy?.email || null,
        file.path,
        file.originalname,
        file.mimetype,
        file.size
      );
      return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8})`;
    });

    const query = `
      INSERT INTO ticket_attachments (
        ticket_id, uploaded_by_id, uploaded_by_name, uploaded_by_email,
        file_path, file_name, file_type, file_size
      ) VALUES ${placeholders.join(', ')}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows;
  }

  /**
   * List attachments for a ticket
   */
  static async findByTicketId(ticketId) {
    const result = await pool.query(
      `SELECT attachment_id, ticket_id, uploaded_by_id, uploaded_by_name, uploaded_by_email,
              file_name, file_type, file_size, created_at
       FROM ticket_attachments
       WHERE ticket_id = $1
       ORDER BY created_at DESC`,
      [ticketId]
    );
    return result.rows;
  }

  /**
   * Get attachment by id
   */
  static async findById(attachmentId) {
    const result = await pool.query(
      'SELECT * FROM ticket_attachments WHERE attachment_id = $1',
      [attachmentId]
    );
    return result.rows[0];
  }
}

module.exports = TicketAttachment;
