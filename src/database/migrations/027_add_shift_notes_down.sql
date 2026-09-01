-- Rollback for 027. Drops the shift notes and puts 'critical' back.
DROP TABLE IF EXISTS production_shift_notes;

ALTER TABLE production_change_log DROP CONSTRAINT IF EXISTS chk_change_action;
DELETE FROM production_change_log WHERE action IN ('shift_note_set', 'shift_note_cleared');
ALTER TABLE production_change_log ADD CONSTRAINT chk_change_action CHECK (action IN (
    'created', 'updated', 'moved', 'deleted', 'restored',
    'unscheduled', 'scheduled', 'day_flag_set', 'day_flag_cleared'
));

ALTER TABLE production_day_flags DROP CONSTRAINT IF EXISTS chk_day_flag;
UPDATE production_day_flags SET flag = 'critical' WHERE flag = 'important';
ALTER TABLE production_day_flags
    ADD CONSTRAINT chk_day_flag CHECK (flag IN ('free', 'critical', 'urgent'));
