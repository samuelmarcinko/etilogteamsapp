-- Reverse of 029.
--
-- The columns come back, but empty: 029 dropped them precisely because what
-- they held was already stored in planned_quantity, and there is nothing to
-- reconstruct the split of "112" back into "84+28" from. The retired statuses
-- come back as values the constraint permits again; no card is moved into them,
-- because 029 could not record which ones had been there.
ALTER TABLE production_plan_entries DROP CONSTRAINT IF EXISTS chk_entry_quantity;

ALTER TABLE production_plan_entries
    ALTER COLUMN planned_quantity TYPE NUMERIC(12, 2);

ALTER TABLE production_plan_entries ADD COLUMN IF NOT EXISTS quantity_breakdown JSONB;
ALTER TABLE production_plan_entries ADD COLUMN IF NOT EXISTS raw_quantity TEXT;

ALTER TABLE production_plan_entries DROP CONSTRAINT IF EXISTS chk_entry_status;
ALTER TABLE production_plan_entries
    ADD CONSTRAINT chk_entry_status CHECK (status IN ('planned', 'in_progress', 'done', 'cancelled'));
