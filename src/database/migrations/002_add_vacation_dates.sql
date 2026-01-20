-- Add start_date and end_date columns for vacation/sick leave requests
-- This allows tracking date ranges for time-off requests

ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS start_date DATE,
ADD COLUMN IF NOT EXISTS end_date DATE;

-- Create index for faster querying of vacation dates
CREATE INDEX IF NOT EXISTS idx_tickets_start_date ON tickets(start_date) WHERE start_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_end_date ON tickets(end_date) WHERE end_date IS NOT NULL;

-- Add comment to explain these columns
COMMENT ON COLUMN tickets.start_date IS 'Start date for vacation/sick leave requests';
COMMENT ON COLUMN tickets.end_date IS 'End date for vacation/sick leave requests';
