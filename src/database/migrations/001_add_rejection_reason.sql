-- Add rejection_reason column to tickets table
-- This allows the rejection reason to be easily accessible when querying tickets

ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Create index for faster queries on rejected tickets
CREATE INDEX IF NOT EXISTS idx_tickets_rejection_reason ON tickets(rejection_reason) WHERE rejection_reason IS NOT NULL;
