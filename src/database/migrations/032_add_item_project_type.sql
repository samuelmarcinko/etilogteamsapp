-- 032: remember which platform a finished good is
--
-- SLT / TXT / GLT / KLT is written in the production order's product
-- description, not on the item, so a project whose order has closed has nowhere
-- to read it from - and a project planned before its order exists never had one.
-- Both are ordinary cases here: work is planned ahead, and projects are picked
-- up again months later.
--
-- It matters because the platform changes what counts as a problem. A TXT
-- project is bags sewn into a container the customer already owns; it has no
-- construction by design, and warning about the missing one would be noise.
-- Without this column such a project reads as an ordinary "no construction
-- found", which is not wrong but is less helpful than the truth.
--
-- Filled by the sync from the order it already reads, and by a live read from
-- the newest order of any status - a closed one still says what the project is.
-- Null stays perfectly valid: SAP genuinely may not say.

ALTER TABLE sap_items
    ADD COLUMN IF NOT EXISTS project_type VARCHAR(10);
