-- 031 down: remove the SAP mirror
--
-- Everything here is a copy of SAP and can be rebuilt by one sync pass, with a
-- single exception: sap_item_kinds holds the planner's own decisions about which
-- components are constructions and which are bags, and those cannot be
-- recovered from anywhere. Save them before running this if they matter:
--
--   COPY (SELECT item_code, kind, reason, set_by_name, set_at
--           FROM sap_item_kinds WHERE source = 'manual')
--     TO '/tmp/sap_item_kinds.csv' CSV HEADER;

DROP INDEX IF EXISTS idx_entries_sap_order;
ALTER TABLE production_plan_entries DROP COLUMN IF EXISTS sap_order_entry;

DROP TABLE IF EXISTS sap_sync_log;
DROP TABLE IF EXISTS sap_item_kinds;
DROP TABLE IF EXISTS sap_boms;
DROP TABLE IF EXISTS sap_production_orders;
DROP TABLE IF EXISTS sap_item_stock;
DROP TABLE IF EXISTS sap_items;
