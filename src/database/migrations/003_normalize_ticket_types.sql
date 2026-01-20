-- Normalize ticket_type values to lowercase for consistency
-- This migration converts existing ticket_type values to lowercase format

UPDATE tickets
SET ticket_type = LOWER(ticket_type)
WHERE ticket_type IS NOT NULL;

-- Standardize specific values
UPDATE tickets
SET ticket_type = 'vacation'
WHERE LOWER(ticket_type) = 'vacation';

UPDATE tickets
SET ticket_type = 'sick-leave'
WHERE LOWER(ticket_type) IN ('sick-leave', 'sick leave', 'pn-ka', 'pnka');

UPDATE tickets
SET ticket_type = 'purchase'
WHERE LOWER(ticket_type) = 'purchase';

UPDATE tickets
SET ticket_type = 'expense'
WHERE LOWER(ticket_type) = 'expense';

UPDATE tickets
SET ticket_type = 'hr'
WHERE LOWER(ticket_type) IN ('hr', 'hr matters');

UPDATE tickets
SET ticket_type = 'other'
WHERE LOWER(ticket_type) = 'other' OR ticket_type = '';

-- Add comment
COMMENT ON COLUMN tickets.ticket_type IS 'Type of ticket: vacation, sick-leave, purchase, expense, hr, other (lowercase)';
