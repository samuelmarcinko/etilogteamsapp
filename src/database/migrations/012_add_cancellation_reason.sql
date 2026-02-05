-- Add cancellation_reason column to tickets table
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Update status constraint to allow 'Cancelled'
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS chk_status;
ALTER TABLE tickets ADD CONSTRAINT chk_status CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled'));

-- Update action constraint to allow 'Cancelled'
ALTER TABLE ticket_actions DROP CONSTRAINT IF EXISTS chk_action;
ALTER TABLE ticket_actions ADD CONSTRAINT chk_action CHECK (action IN ('Created', 'Approved', 'Rejected', 'Viewed', 'Cancelled'));
