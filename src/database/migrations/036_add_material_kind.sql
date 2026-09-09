-- 036: dva druhy položiek v evidencii - zo SAPu a vlastné
--
-- Evidencia mieša dve veci, ktoré si len navonok podobné:
--
--   * skladová položka, ktorú SAP pozná a vie o nej, koľko jej je (RM, SG)
--   * poznámka skladníka - „tašky k projektu FG100875 ležia na B-21" -
--     zapísaná pod číslom projektu, hoci projekt skladovou položkou nie je
--
-- Doteraz sa nedali rozlíšiť, lebo tlačidlo „Pridať" bolo jedno a nebolo ako
-- povedať „toto nie je položka zo SAPu". Tak vzniklo 39 riadkov s FG číslom a
-- počtom 1, ktoré synchronizácia zhodí na nulu, lebo SAP na projekt zásobu
-- nevedie. Zhodiť ich by znamenalo zobrať skladníkovi jedinú evidenciu toho,
-- ktoré tašky ku ktorému projektu kde ležia.
--
-- `kind` z toho robí rozhodnutie, ktoré človek urobí vedome pri zakladaní.
-- Bez neho by sa ten neporiadok o rok zopakoval - dáta by sa upratali a dvere,
-- ktorými prišli, by zostali otvorené.

ALTER TABLE materials ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'sap';

ALTER TABLE materials DROP CONSTRAINT IF EXISTS chk_material_kind;
ALTER TABLE materials ADD CONSTRAINT chk_material_kind CHECK (kind IN ('sap', 'local'));

-- Projekt, ku ktorému vlastná položka patrí. Pri položkách zo SAPu prázdne.
-- Existuje preto, aby sa tašky dali nájsť podľa FG čísla aj potom, ako prestane
-- byť ich kódom.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS project_fg VARCHAR(50);

-- Ako sa riadok volal predtým. Premenovanie sa tým dá vrátiť jedným UPDATE -
-- obnova celej zálohy by zahodila aj všetko ostatné, čo sa medzitým v portáli
-- stalo, a to je príliš vysoká cena za návrat jednej zmeny názvov.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS legacy_code VARCHAR(100);
ALTER TABLE materials ADD COLUMN IF NOT EXISTS legacy_name VARCHAR(255);

-- ------------------------------------------------------- zaradenie existujúcich
-- Kód začínajúci na FG je číslo projektu, nie skladovej položky. Také riadky sú
-- poznámky a od SAPu sa odpájajú - vrátane počtov, ktoré zostávajú presne tak,
-- ako ich skladníci zapísali.
--
-- Kódy RM a SG zostávajú pri SAPe. Aj tie, ktoré vyzerajú ako poznámka
-- (RM102281 „Rohy na kryty" s počtom 1): SAP na nich zásobu vedie - 330 kusov -
-- takže tá jednotka nie je značka, ale zle zapísaný počet, a synchronizácia ho
-- opraví.
UPDATE materials
   SET kind = 'local',
       project_fg = upper(code),
       sap_item_code = NULL
 WHERE code ILIKE 'FG%' AND kind <> 'local';

CREATE INDEX IF NOT EXISTS idx_materials_kind ON materials(kind);
CREATE INDEX IF NOT EXISTS idx_materials_project_fg ON materials(project_fg);
