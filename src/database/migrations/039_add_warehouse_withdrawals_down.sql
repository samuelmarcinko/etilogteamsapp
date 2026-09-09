-- Undo 039.
--
-- Pozor: zahodí to celú históriu vyskladnení. Počty na pozíciách sa NEvracajú
-- späť - tie sa medzitým odpočítali a od vtedy s nimi pracovali ľudia. Vrátiť
-- ich tu naslepo by prepísalo prácu, o ktorej táto migrácia nič nevie.
-- Jednotlivé vyskladnenie sa poriadne vracia stornom v appke, nie týmto.

-- Najprv sa právo odoberie rolám, potom sa zúži zoznam - inak by nové
-- obmedzenie odmietli riadky, ktoré v tabuľke už sú.
DELETE FROM role_permissions WHERE permission_key = 'warehouse.withdraw';

ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS chk_permission_key;

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

DROP INDEX IF EXISTS idx_withdrawals_material;
DROP INDEX IF EXISTS idx_withdrawals_created_at;
DROP TABLE IF EXISTS warehouse_withdrawals;

ALTER TABLE users DROP COLUMN IF EXISTS withdrawals_seen_at;
ALTER TABLE users DROP COLUMN IF EXISTS is_kiosk;
ALTER TABLE users DROP COLUMN IF EXISTS pin_locked_until;
ALTER TABLE users DROP COLUMN IF EXISTS failed_pins;
ALTER TABLE users DROP COLUMN IF EXISTS pin_set_at;
ALTER TABLE users DROP COLUMN IF EXISTS pin_hash;
