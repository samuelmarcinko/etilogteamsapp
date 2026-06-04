-- Add 'Updated' action to ticket_actions CHECK constraint for admin edits

-- Drop the old constraint
ALTER TABLE ticket_actions DROP CONSTRAINT IF EXISTS chk_action;

-- Add new constraint with 'Updated' action included
ALTER TABLE ticket_actions ADD CONSTRAINT chk_action
  CHECK (action IN ('Created', 'Approved', 'Rejected', 'Viewed', 'Updated'));
