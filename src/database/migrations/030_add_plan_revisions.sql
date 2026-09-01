-- 030: published revisions of the plan
--
-- Until now every change was live the moment it was made. That was tolerable
-- while the only people looking were the planners making them; it stopped being
-- tolerable when the shop-floor viewer arrived and started refreshing itself
-- every minute. A planner rearranging five cards now shows the floor five
-- half-finished plans, one a minute, and nothing distinguishes a decision from
-- thinking out loud.
--
-- So the floor reads a published revision instead of the live rows. One week is
-- one revision; publishing a week snapshots it and bumps its number.
--
-- The planner's own tables are untouched: no draft flag on the cards, no second
-- state to keep in sync, nothing that every existing query has to learn about.
-- A revision is simply a copy of what a week looked like at a moment someone
-- chose.
CREATE TABLE IF NOT EXISTS production_plan_revisions (
    id                BIGSERIAL PRIMARY KEY,
    location_id       INTEGER NOT NULL REFERENCES production_locations(id) ON DELETE CASCADE,
    -- Monday, always: date_trunc('week') is ISO, which is what the grid uses.
    week_start        DATE    NOT NULL,
    revision          INTEGER NOT NULL,
    -- How many differences this publish carried. Kept as a number so the
    -- history still reads sensibly once the snapshot has been pruned.
    change_count      INTEGER NOT NULL DEFAULT 0,

    -- Everything the viewer needs for that week, denormalised on purpose:
    -- FG numbers, product descriptions and shift names as they read when it was
    -- published. A revision is what the floor was told, not a pointer to what
    -- the master data says today.
    --
    -- Nullable because retention strips it from old revisions; the row itself
    -- survives as the audit trail.
    snapshot          JSONB,

    published_by      VARCHAR(255),
    published_by_name VARCHAR(255),
    published_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_plan_revision UNIQUE (location_id, week_start, revision)
);

-- The viewer's only question: the newest revision of these weeks.
CREATE INDEX IF NOT EXISTS idx_plan_revisions_current
    ON production_plan_revisions(location_id, week_start, revision DESC);

CREATE INDEX IF NOT EXISTS idx_plan_revisions_published
    ON production_plan_revisions(location_id, published_at DESC);

-- ---------------------------------------------------------------------------
-- Day one.
--
-- A week with no revision has not been published, and the viewer says exactly
-- that rather than falling back to the live rows - a fallback would leave the
-- floor watching the planner think on any week nobody had published yet, which
-- is the whole problem this table exists to solve.
--
-- Which means that without this backfill the floor would arrive to an empty
-- plan on the morning of the deploy. So every week that already holds
-- production gets Revision 1: a snapshot of exactly what is on screen today.
-- Nothing changes for anyone, and publishing works normally from here.
--
-- It is done here rather than in a script because a script can be forgotten and
-- a migration cannot.
INSERT INTO production_plan_revisions
    (location_id, week_start, revision, change_count, snapshot, published_by_name, published_at)
SELECT
    w.location_id,
    w.week_start,
    1,
    0,
    jsonb_build_object(
        'entries',    COALESCE(e.rows, '[]'::jsonb),
        'dayFlags',   COALESCE(f.rows, '[]'::jsonb),
        'shiftNotes', COALESCE(n.rows, '[]'::jsonb)
    ),
    'Initial publish',
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT location_id, date_trunc('week', production_date)::date AS week_start
      FROM production_plan_entries
     WHERE production_date IS NOT NULL
       AND deleted_at IS NULL
) w

LEFT JOIN LATERAL (
    -- shift_sort only exists to order the rows; it is dropped again so the
    -- snapshot carries exactly the fields the plan API returns and nothing else.
    SELECT jsonb_agg((to_jsonb(x) - 'shift_sort')
                     ORDER BY x.production_date, x.shift_sort, x.sort_order, x.id) AS rows
      FROM (
        SELECT en.id,
               en.location_id,
               en.production_date,
               en.shift_id,
               s.name AS shift_name,
               en.product_id,
               p.fg_number,
               p.description AS product_description,
               en.custom_product_name,
               en.planned_quantity,
               en.priority,
               en.color,
               en.status,
               en.notes,
               en.sort_order,
               en.version,
               en.updated_at,
               en.updated_by_name,
               s.sort_order AS shift_sort
          FROM production_plan_entries en
          LEFT JOIN products          p ON p.id = en.product_id
          LEFT JOIN production_shifts s ON s.id = en.shift_id
         WHERE en.location_id = w.location_id
           AND en.deleted_at IS NULL
           AND date_trunc('week', en.production_date)::date = w.week_start
      ) x
) e ON TRUE

LEFT JOIN LATERAL (
    SELECT jsonb_agg(row_to_json(y) ORDER BY y.production_date) AS rows
      FROM (
        SELECT df.id, df.production_date, df.flag, df.note
          FROM production_day_flags df
         WHERE df.location_id = w.location_id
           AND date_trunc('week', df.production_date)::date = w.week_start
      ) y
) f ON TRUE

LEFT JOIN LATERAL (
    SELECT jsonb_agg(row_to_json(z) ORDER BY z.production_date, z.shift_id) AS rows
      FROM (
        SELECT sn.id, sn.production_date, sn.shift_id, sn.note
          FROM production_shift_notes sn
         WHERE sn.location_id = w.location_id
           AND date_trunc('week', sn.production_date)::date = w.week_start
      ) z
) n ON TRUE

ON CONFLICT (location_id, week_start, revision) DO NOTHING;
