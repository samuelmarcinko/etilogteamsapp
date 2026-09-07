-- 033: a permission for "tell me when the plan changes"
--
-- Who hears about a publish is a question about people, not configuration, so
-- it is answered where every other question about who-may-what is answered:
-- the permission matrix in the admin screen. A role with this key gets a Teams
-- message when the plan is published; admin holds every key by definition, so
-- administrators are included without anyone having to remember to add them.
--
-- Kept separate from production.view on purpose. Plenty of people need to read
-- the plan without wanting a message every time it moves, and one checkbox
-- that means both would force those two decisions to be the same.
--
-- The only change here is widening the CHECK that lists the valid keys. No
-- table is restructured and no existing row is touched; a role that had no
-- permissions before still has none.

ALTER TABLE role_permissions
    DROP CONSTRAINT IF EXISTS chk_permission_key;

ALTER TABLE role_permissions
    ADD CONSTRAINT chk_permission_key CHECK (permission_key IN (
        'hr.access',
        'hr.manage',
        'fleet.access',
        'warehouse.read',
        'warehouse.write',
        'production.view',
        'production.manage',
        'production.notify'
    ));
