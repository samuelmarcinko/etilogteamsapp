-- Rollback for 026_add_unscheduled_and_audit.sql
--
-- Not executed by the runner (*_down.sql is ignored); apply by hand.
--
-- DESTRUCTIVE: drops the change log, and restoring the NOT NULL on
-- production_date fails while any unscheduled entry exists. Deal with those
-- first - either schedule them or delete them - then run this.
--
--   SELECT id, custom_product_name, product_id FROM production_plan_entries
--    WHERE production_date IS NULL AND deleted_at IS NULL;

DROP TABLE IF EXISTS production_change_log;

DROP INDEX IF EXISTS idx_plan_entries_unscheduled;

ALTER TABLE production_plan_entries DROP CONSTRAINT IF EXISTS chk_entry_scheduled;
ALTER TABLE production_plan_entries DROP COLUMN IF EXISTS due_date;
ALTER TABLE production_plan_entries ALTER COLUMN production_date SET NOT NULL;
