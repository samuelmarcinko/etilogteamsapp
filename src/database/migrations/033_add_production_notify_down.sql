-- Undo 033.
--
-- Any role holding the key must lose it first, or the narrowed CHECK would be
-- rejected by rows that already exist.

DELETE FROM role_permissions WHERE permission_key = 'production.notify';

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
        'production.manage'
    ));
