CREATE TABLE IF NOT EXISTS ticket_attachments (
  attachment_id SERIAL PRIMARY KEY,
  ticket_id VARCHAR(50) NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
  uploaded_by_id VARCHAR(255),
  uploaded_by_name VARCHAR(255),
  uploaded_by_email VARCHAR(255),
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket_id
  ON ticket_attachments(ticket_id);
