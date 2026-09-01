-- 028: two priorities, and a colour of your own for everything else
--
-- Four priorities (normal / high / urgent / blocked) turned out to be three
-- more than the plan needs: what a planner actually wants is "this one is
-- urgent" and "these three belong together". So priority keeps only urgent,
-- and everything else carries a colour the planner picks - the same colour on
-- the same family of work, so related jobs are one glance apart.
--
-- The two retired priorities are carried over as colours rather than dropped,
-- so nothing that was marked loses its marking: high was orange on the card
-- and blocked was amber, and that is exactly what they become.
ALTER TABLE production_plan_entries ADD COLUMN IF NOT EXISTS color VARCHAR(20);

UPDATE production_plan_entries SET color = 'orange' WHERE priority = 'high' AND color IS NULL;
UPDATE production_plan_entries SET color = 'amber'  WHERE priority = 'blocked' AND color IS NULL;
UPDATE production_plan_entries SET priority = 'normal' WHERE priority IN ('high', 'blocked');

ALTER TABLE production_plan_entries DROP CONSTRAINT IF EXISTS chk_entry_priority;
ALTER TABLE production_plan_entries
    ADD CONSTRAINT chk_entry_priority CHECK (priority IN ('normal', 'urgent'));

-- A fixed palette rather than free-form hex: ten colours chosen to stay
-- distinguishable next to each other and to keep dark text readable on their
-- tint. Free hex would let someone pick a shade that hides its own card.
ALTER TABLE production_plan_entries DROP CONSTRAINT IF EXISTS chk_entry_color;
ALTER TABLE production_plan_entries
    ADD CONSTRAINT chk_entry_color CHECK (color IS NULL OR color IN (
        'sky', 'cyan', 'teal', 'emerald', 'lime',
        'amber', 'orange', 'pink', 'violet', 'slate'
    ));
