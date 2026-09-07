-- Undo 037.
--
-- NOT NULL sa nedá vrátiť, kým existuje riadok bez kódu - tak tie dostanú
-- späť svoj pôvodný kód, ak ho premenovací skript odložil, a inak náhradu
-- odvodenú od projektu. Je to menej zlé než zlyhaná migrácia alebo zmazané
-- riadky.

UPDATE materials
   SET code = COALESCE(legacy_code, project_fg, 'LOK-' || id::text)
 WHERE code IS NULL;

ALTER TABLE materials ALTER COLUMN code SET NOT NULL;
