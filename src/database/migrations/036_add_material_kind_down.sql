-- Undo 036.
--
-- Vráti kódy a názvy premenovaných riadkov tam, kde je z čoho - `legacy_code`
-- a `legacy_name` píše premenovací skript, nie táto migrácia, takže riadky,
-- ktoré sa nikdy nepremenovali, sa nemenia.
--
-- Väzba na SAP sa obnovuje z kódu, čo je stav pred 036.

UPDATE materials
   SET code = COALESCE(legacy_code, code),
       name = COALESCE(legacy_name, name)
 WHERE legacy_code IS NOT NULL OR legacy_name IS NOT NULL;

UPDATE materials SET sap_item_code = code WHERE sap_item_code IS NULL;

DROP INDEX IF EXISTS idx_materials_project_fg;
DROP INDEX IF EXISTS idx_materials_kind;

ALTER TABLE materials DROP CONSTRAINT IF EXISTS chk_material_kind;
ALTER TABLE materials DROP COLUMN IF EXISTS legacy_name;
ALTER TABLE materials DROP COLUMN IF EXISTS legacy_code;
ALTER TABLE materials DROP COLUMN IF EXISTS project_fg;
ALTER TABLE materials DROP COLUMN IF EXISTS kind;
