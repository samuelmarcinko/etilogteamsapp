-- Undo 032.
--
-- Nothing is lost that cannot be read again: the column is filled from SAP on
-- every pass, so dropping it costs one sync to restore.

ALTER TABLE sap_items
    DROP COLUMN IF EXISTS project_type;
