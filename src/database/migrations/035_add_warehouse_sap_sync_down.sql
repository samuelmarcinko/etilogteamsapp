-- Undo 035.
--
-- Len odoberá to, čo 035 pridala. `quantity` ani rozpisy po paletách sa tu
-- nevracajú - ak už synchronizácia počty prepísala, návratom je prehratie
-- `before_state` z warehouse_sync_log, a to sa musí stať PRED spustením tohto
-- skriptu, lebo ten log tu zaniká.

DROP TABLE IF EXISTS warehouse_sync_log;

DROP INDEX IF EXISTS idx_materials_sap_item;

ALTER TABLE materials DROP COLUMN IF EXISTS sap_item_code;
ALTER TABLE materials DROP COLUMN IF EXISTS sap_known;
ALTER TABLE materials DROP COLUMN IF EXISTS sap_synced_at;
ALTER TABLE materials DROP COLUMN IF EXISTS sap_uom;
ALTER TABLE materials DROP COLUMN IF EXISTS sap_name;
ALTER TABLE materials DROP COLUMN IF EXISTS sap_quantity;
