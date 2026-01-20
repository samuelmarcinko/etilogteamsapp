-- Drop old check constraint on ticket_type
ALTER TABLE tickets
DROP CONSTRAINT IF EXISTS chk_ticket_type;

-- Add new check constraint with lowercase values including sick-leave
ALTER TABLE tickets
ADD CONSTRAINT chk_ticket_type
CHECK (ticket_type IN ('vacation', 'sick-leave', 'purchase', 'expense', 'hr', 'other'));

-- Update comment
COMMENT ON CONSTRAINT chk_ticket_type ON tickets IS
'Allowed ticket types: vacation, sick-leave, purchase, expense, hr, other (lowercase only)';
