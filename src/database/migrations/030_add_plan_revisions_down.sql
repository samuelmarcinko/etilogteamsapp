-- Reverse of 030.
--
-- Dropping the table takes the published history with it; the plan itself is
-- untouched, because 030 never wrote to it. The viewer goes back to reading the
-- live rows, which is exactly where it was before.
DROP TABLE IF EXISTS production_plan_revisions;
