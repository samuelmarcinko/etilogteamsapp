-- Rollback for 028. Puts the four priorities back and drops the colour.
-- The high/blocked distinction cannot be recovered from the colours (a planner
-- may have set orange themselves since), so those rows stay 'normal'.
ALTER TABLE production_plan_entries DROP CONSTRAINT IF EXISTS chk_entry_color;
ALTER TABLE production_plan_entries DROP COLUMN IF EXISTS color;

ALTER TABLE production_plan_entries DROP CONSTRAINT IF EXISTS chk_entry_priority;
ALTER TABLE production_plan_entries
    ADD CONSTRAINT chk_entry_priority CHECK (priority IN ('normal', 'high', 'urgent', 'blocked'));
