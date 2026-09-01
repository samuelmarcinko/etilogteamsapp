-- Performance Optimization: Add missing database indexes
-- Migration 013: Database indexes for frequently queried columns

-- employee_quotas indexes (critical for quota lookups)
CREATE INDEX IF NOT EXISTS idx_quotas_user_year ON employee_quotas(user_id, year);
CREATE INDEX IF NOT EXISTS idx_quotas_year ON employee_quotas(year);

-- sick_notes indexes (improves listing and filtering)
CREATE INDEX IF NOT EXISTS idx_sick_notes_user_id ON sick_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_sick_notes_start_date ON sick_notes(start_date);
CREATE INDEX IF NOT EXISTS idx_sick_notes_created_at ON sick_notes(created_at);

-- ticket_attachments index (faster attachment lookups)
CREATE INDEX IF NOT EXISTS idx_attachments_ticket_id ON ticket_attachments(ticket_id);

-- users email index (faster user lookups by email)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- tickets composite index for common filtered queries
CREATE INDEX IF NOT EXISTS idx_tickets_status_created ON tickets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_type_status ON tickets(ticket_type, status);

-- holidays index for date range queries
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
CREATE INDEX IF NOT EXISTS idx_holidays_year ON holidays(EXTRACT(YEAR FROM date));
