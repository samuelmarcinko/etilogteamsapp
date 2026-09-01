-- 027: notes per shift, and "critical" renamed to "important"
--
-- The Excel sheet had one Notes row under the week. In practice the morning and
-- the afternoon shift are often running different orders, so a single note per
-- day merges two unrelated remarks into one cell and the planner has to write
-- "ranna: ... poobede: ..." by hand. One note per shift per day instead.
--
-- Kept in its own table rather than added to production_day_flags: a note is
-- not a flag, it outlives flags being set and cleared, and a flag row is
-- deleted when the flag is removed - which would take the note with it.
CREATE TABLE IF NOT EXISTS production_shift_notes (
    id              SERIAL PRIMARY KEY,
    location_id     INTEGER NOT NULL REFERENCES production_locations(id) ON DELETE CASCADE,
    production_date DATE NOT NULL,
    shift_id        INTEGER NOT NULL REFERENCES production_shifts(id) ON DELETE CASCADE,
    note            TEXT NOT NULL,

    created_by      VARCHAR(255),
    created_by_name VARCHAR(255),
    updated_by      VARCHAR(255),
    updated_by_name VARCHAR(255),
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_shift_note UNIQUE (location_id, production_date, shift_id)
);

-- The grid asks for a whole visible range at a time, same as entries do.
CREATE INDEX IF NOT EXISTS idx_shift_notes_range
    ON production_shift_notes(location_id, production_date);

DROP TRIGGER IF EXISTS trg_shift_notes_updated ON production_shift_notes;
CREATE TRIGGER trg_shift_notes_updated BEFORE UPDATE ON production_shift_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- "critical" said less than it looked like it said - every planner reads it as
-- "important", and the word is what appears in the day header. Renamed at the
-- source so the stored value and the label agree; 'urgent' stays allowed.
ALTER TABLE production_day_flags DROP CONSTRAINT IF EXISTS chk_day_flag;
UPDATE production_day_flags SET flag = 'important' WHERE flag = 'critical';
ALTER TABLE production_day_flags
    ADD CONSTRAINT chk_day_flag CHECK (flag IN ('free', 'important', 'urgent'));

-- Note edits belong in the same history as everything else, so "who wrote
-- that?" is answerable from the activity panel rather than from memory.
ALTER TABLE production_change_log DROP CONSTRAINT IF EXISTS chk_change_action;
ALTER TABLE production_change_log ADD CONSTRAINT chk_change_action CHECK (action IN (
    'created', 'updated', 'moved', 'deleted', 'restored',
    'unscheduled', 'scheduled', 'day_flag_set', 'day_flag_cleared',
    'shift_note_set', 'shift_note_cleared'
));
