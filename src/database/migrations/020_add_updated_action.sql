-- Add 'Updated' and 'Cancelled' actions to ticket_actions CHECK constraint

-- Drop the old constraint
ALTER TABLE ticket_actions DROP CONSTRAINT IF EXISTS chk_action;

-- Add new constraint with 'Updated' (admin edits) and 'Cancelled' actions included
ALTER TABLE ticket_actions ADD CONSTRAINT chk_action
  CHECK (action IN ('Created', 'Approved', 'Rejected', 'Viewed', 'Updated', 'Cancelled'));
