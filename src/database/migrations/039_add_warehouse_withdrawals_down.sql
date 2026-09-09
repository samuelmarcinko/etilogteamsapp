-- Undo 039.
--
-- Pozor: zahodí to celú históriu vyskladnení. Počty na pozíciách sa NEvracajú
-- späť - tie sa medzitým odpočítali a od vtedy s nimi pracovali ľudia. Vrátiť
-- ich tu naslepo by prepísalo prácu, o ktorej táto migrácia nič nevie.
-- Jednotlivé vyskladnenie sa poriadne vracia stornom v appke, nie týmto.

DROP INDEX IF EXISTS idx_withdrawals_material;
DROP INDEX IF EXISTS idx_withdrawals_created_at;
DROP TABLE IF EXISTS warehouse_withdrawals;

ALTER TABLE users DROP COLUMN IF EXISTS withdrawals_seen_at;
ALTER TABLE users DROP COLUMN IF EXISTS is_kiosk;
ALTER TABLE users DROP COLUMN IF EXISTS pin_locked_until;
ALTER TABLE users DROP COLUMN IF EXISTS failed_pins;
ALTER TABLE users DROP COLUMN IF EXISTS pin_set_at;
ALTER TABLE users DROP COLUMN IF EXISTS pin_hash;
