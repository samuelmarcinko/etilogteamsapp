-- Migration 026: Unscheduled queue and the append-only change log
--
-- Two additions the planner needs once it can be edited:
--
-- 1. The Unscheduled queue (section 4.4) holds work that must be produced but
--    has no date yet. That means an entry without a production date, which 025
--    forbade. Relax it, and add the due date such an entry is judged against.
--
-- 2. Every move, edit and delete is written to an append-only log. Draft/publish
--    and revisions come later; the log starts now, because history that was not
--    recorded from the first edit cannot be reconstructed afterwards.
--
-- Rollback: 026_add_unscheduled_and_audit_down.sql

-- =========================================================
-- Unscheduled entries
-- =========================================================
ALTER TABLE production_plan_entries ALTER COLUMN production_date DROP NOT NULL;
ALTER TABLE production_plan_entries ADD COLUMN IF NOT EXISTS due_date DATE;

-- An entry is either scheduled - a date, and a shift within it - or sitting in
-- the queue with neither. A shift without a date would belong to no day.
ALTER TABLE production_plan_entries DROP CONSTRAINT IF EXISTS chk_entry_scheduled;
ALTER TABLE production_plan_entries ADD CONSTRAINT chk_entry_scheduled CHECK (
    production_date IS NOT NULL OR shift_id IS NULL
);

-- The queue is read per location, ordered by how soon the work is due.
CREATE INDEX IF NOT EXISTS idx_plan_entries_unscheduled
    ON production_plan_entries(location_id, due_date NULLS LAST)
    WHERE production_date IS NULL AND deleted_at IS NULL;

-- =========================================================
-- Append-only change log
-- =========================================================
-- Never updated, never deleted. entry_id is deliberately not a foreign key:
-- the log has to outlive the row it describes, including a hard delete.
CREATE TABLE IF NOT EXISTS production_change_log (
    id           BIGSERIAL PRIMARY KEY,
    location_id  INTEGER NOT NULL REFERENCES production_locations(id) ON DELETE CASCADE,
    entry_id     INTEGER,
    action       VARCHAR(30) NOT NULL,

    -- Enough to render "Mon AM: FG100865 -> FG100899" without joining back to
    -- rows that may since have changed or gone.
    summary      TEXT,
    before_state JSONB,
    after_state  JSONB,

    changed_by      VARCHAR(255),
    changed_by_name VARCHAR(255),
    changed_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_change_action CHECK (action IN (
        'created', 'updated', 'moved', 'deleted', 'restored',
        'unscheduled', 'scheduled', 'day_flag_set', 'day_flag_cleared'
    ))
);

CREATE INDEX IF NOT EXISTS idx_change_log_location_time
    ON production_change_log(location_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_change_log_entry
    ON production_change_log(entry_id, changed_at DESC);
