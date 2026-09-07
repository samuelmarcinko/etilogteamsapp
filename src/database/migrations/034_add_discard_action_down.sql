-- Undo 034.
--
-- Any log line using the new actions has to go first, or the narrowed CHECK
-- would be rejected by rows that already exist. That loses audit history, which
-- is why this is a down migration and not something to run casually.

DELETE FROM production_change_log WHERE action IN ('discarded', 'discard_undone');

ALTER TABLE production_change_log
    DROP CONSTRAINT IF EXISTS chk_change_action;

ALTER TABLE production_change_log
    ADD CONSTRAINT chk_change_action CHECK (action IN (
        'created', 'updated', 'moved', 'deleted', 'restored',
        'unscheduled', 'scheduled', 'day_flag_set', 'day_flag_cleared'
    ));
