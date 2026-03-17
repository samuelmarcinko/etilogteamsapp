-- Migration 015: Add half-day vacation/leave support
-- Allows employees to request half-day (0.5) time off

-- Add is_half_day flag to tickets table
ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS is_half_day BOOLEAN DEFAULT FALSE;

-- Update quota totals columns to support decimal values (0.5 increments)
-- vacation_days_total, paragraph_days_total, ocr_days_total, sick_days_total
ALTER TABLE employee_quotas
ALTER COLUMN vacation_days_total TYPE NUMERIC(5,1);

ALTER TABLE employee_quotas
ALTER COLUMN sick_days_total TYPE NUMERIC(5,1);

ALTER TABLE employee_quotas
ALTER COLUMN paragraph_days_total TYPE NUMERIC(5,1);

ALTER TABLE employee_quotas
ALTER COLUMN ocr_days_total TYPE NUMERIC(5,1);

-- Update quota_settings defaults to NUMERIC as well
ALTER TABLE quota_settings
ALTER COLUMN default_vacation_days TYPE NUMERIC(5,1);

ALTER TABLE quota_settings
ALTER COLUMN default_sick_days TYPE NUMERIC(5,1);

ALTER TABLE quota_settings
ALTER COLUMN default_paragraph_days TYPE NUMERIC(5,1);

ALTER TABLE quota_settings
ALTER COLUMN default_ocr_days TYPE NUMERIC(5,1);

ALTER TABLE quota_settings
ALTER COLUMN max_carry_over_days TYPE NUMERIC(5,1);

-- Add index for half-day queries
CREATE INDEX IF NOT EXISTS idx_tickets_is_half_day ON tickets(is_half_day) WHERE is_half_day = TRUE;

-- Add comment to explain the column
COMMENT ON COLUMN tickets.is_half_day IS 'True if this is a half-day (0.5) request, only valid when start_date = end_date';
