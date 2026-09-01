-- 029: two statuses, and a quantity that is a whole number of pieces
--
-- Status had four values inherited from a generic workflow: planned,
-- in_progress, done, cancelled. On the shop floor a card is either still to be
-- made or it is finished, and "in progress" was never once set deliberately -
-- the plan is read at a glance and a third shade of half-done only makes the
-- glance slower. So: planned and done, nothing else.
--
-- in_progress becomes planned, because work that has started has not finished.
-- cancelled becomes planned too - there is no honest mapping for it in a
-- two-state world, and returning the card to the plan is safer than deciding on
-- the planner's behalf that it should vanish. A card that really is cancelled
-- is deleted, which is reversible from the activity log.
UPDATE production_plan_entries SET status = 'planned' WHERE status IN ('in_progress', 'cancelled');

ALTER TABLE production_plan_entries DROP CONSTRAINT IF EXISTS chk_entry_status;
ALTER TABLE production_plan_entries
    ADD CONSTRAINT chk_entry_status CHECK (status IN ('planned', 'done'));

-- Quantity: one whole number of pieces.
--
-- The Excel sheets carried values like "130+22" - two deliveries against one
-- FG on one shift, written into a single cell because a spreadsheet cell is all
-- there was. The plan has cards, and two deliveries are two cards (or one card
-- split in two, which the Split button does). So the composite forms go, and
-- with them the two columns that existed only to hold them.
--
-- Nothing is lost in doing so: every breakdown recorded here sums to exactly
-- the planned quantity beside it, and every raw string is one of those sums
-- written out. The total is the part that matters and it is already stored.
UPDATE production_plan_entries
   SET planned_quantity = (
           SELECT SUM(part::numeric)
             FROM jsonb_array_elements_text(quantity_breakdown -> 'parts') AS part
       )
 WHERE planned_quantity IS NULL
   AND jsonb_typeof(quantity_breakdown -> 'parts') = 'array';

UPDATE production_plan_entries
   SET planned_quantity = raw_quantity::numeric
 WHERE planned_quantity IS NULL
   AND raw_quantity ~ '^\s*\d+(\.\d+)?\s*$';

ALTER TABLE production_plan_entries DROP COLUMN IF EXISTS quantity_breakdown;
ALTER TABLE production_plan_entries DROP COLUMN IF EXISTS raw_quantity;

-- Pieces are counted, not measured. numeric(12,2) let 240.50 through, which is
-- not a quantity anyone can produce; INTEGER makes "whole number" a fact of the
-- table rather than a rule the API is trusted to remember.
ALTER TABLE production_plan_entries
    ALTER COLUMN planned_quantity TYPE INTEGER USING ROUND(planned_quantity);

ALTER TABLE production_plan_entries DROP CONSTRAINT IF EXISTS chk_entry_quantity;
ALTER TABLE production_plan_entries
    ADD CONSTRAINT chk_entry_quantity CHECK (planned_quantity IS NULL OR planned_quantity >= 0);
