-- 034: let the change log record a discard
--
-- Discard throws away everything unpublished in a set of weeks and puts the
-- last published plan back. It is the one operation in the module that can
-- destroy work, so it is exactly the one the audit log must be able to name -
-- and the CHECK below listed every other action but not this.
--
-- Two keys rather than one. 'discarded' is the operation; 'discard_undone' is
-- somebody taking it back within the thirty seconds the toast is up. Recording
-- the second as another 'restored' would leave the log saying work was thrown
-- away with nothing after it to say the planner changed their mind.
--
-- Widening a CHECK only. No table is restructured and no existing row is
-- touched or re-validated against anything it did not already satisfy.

ALTER TABLE production_change_log
    DROP CONSTRAINT IF EXISTS chk_change_action;

ALTER TABLE production_change_log
    ADD CONSTRAINT chk_change_action CHECK (action IN (
        'created', 'updated', 'moved', 'deleted', 'restored',
        'unscheduled', 'scheduled', 'day_flag_set', 'day_flag_cleared',
        'discarded', 'discard_undone'
    ));
