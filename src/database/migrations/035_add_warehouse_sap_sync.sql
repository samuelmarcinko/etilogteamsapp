-- 035: napojenie skladového modulu na SAP (sklad 02-03)
--
-- Skladníci zadávali kódy aj počty ručne, lebo modul napojený nebol. Teraz sa
-- počty dajú brať zo SAPu - ale len počty. Rozdelenie tovaru po paletových
-- miestach nevie SAP a nikdy vedieť nebude, to zostáva prácou skladu.
--
-- Všetko sú NOVÉ stĺpce a NOVÁ tabuľka. Žiadny existujúci stĺpec sa nemení,
-- nemaže ani neprepisuje, takže modul po tejto migrácii funguje presne tak ako
-- pred ňou - kým sa synchronizácia zapne.

-- ------------------------------------------------------------ čo hovorí SAP
-- Držané oddelene od `quantity`. Kým sa ukazuje len toto, skladník na obrazovke
-- žiadnu zmenu nevidí a dá sa v pokoji overiť, či čísla dávajú zmysel.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS sap_quantity  NUMERIC(16,4);
ALTER TABLE materials ADD COLUMN IF NOT EXISTS sap_name      TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS sap_uom       VARCHAR(30);
ALTER TABLE materials ADD COLUMN IF NOT EXISTS sap_synced_at TIMESTAMP;

-- NULL = ešte sa nesynchronizovalo, TRUE/FALSE = SAP kód pozná / nepozná.
-- Tri stavy, nie dva: „nevieme" a „SAP o tom nevie" sú rôzne veci a na
-- obrazovke musia vyzerať rôzne.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS sap_known BOOLEAN;

-- Položka v SAPe, proti ktorej sa tento riadok synchronizuje. NULL znamená
-- „nesynchronizovať" - to bude prípad tašiek evidovaných pod FG číslom
-- projektu, ktoré skladovou položkou nikdy neboli.
--
-- Vypĺňa sa kódom, lebo dnes to tak je pri každom riadku; existuje preto, aby
-- sa tá väzba dala rozpojiť bez toho, aby sa musel meniť kód materiálu.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS sap_item_code VARCHAR(50);
UPDATE materials SET sap_item_code = code WHERE sap_item_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_materials_sap_item ON materials(sap_item_code);

-- ------------------------------------------------------------------- log
-- Kedy naposledy prešla, ako dopadla a čo urobila. Bez toho sa nedá odpovedať
-- na otázku, ktorú položí každý, kto uvidí divné číslo: „kedy sa to naposledy
-- ťahalo?" - a hlavne sa nedá spoznať synchronizácia, ktorá týždeň potichu
-- padá.
CREATE TABLE IF NOT EXISTS warehouse_sync_log (
    id            SERIAL PRIMARY KEY,
    started_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at   TIMESTAMP,
    duration_ms   INTEGER,

    warehouse     VARCHAR(20),      -- proti ktorému skladu sa ťahalo (02-03)
    codes         INTEGER NOT NULL DEFAULT 0,   -- koľko kódov sa pýtalo
    matched       INTEGER NOT NULL DEFAULT 0,   -- koľko z nich SAP pozná
    unknown       INTEGER NOT NULL DEFAULT 0,
    changed       INTEGER NOT NULL DEFAULT 0,   -- koľkým sa zmenil počet
    http_calls    INTEGER NOT NULL DEFAULT 0,

    -- Prepísali sa aj `quantity` a jednopozičné rozpisy, alebo sa len
    -- zaznamenalo, čo SAP hovorí? Prvé behy budú to druhé.
    applied       BOOLEAN NOT NULL DEFAULT FALSE,

    -- Pôvodné množstvá pred zápisom, po riadkoch. Toto je návratová cesta:
    -- vrátiť jeden beh znamená prehrať tento zoznam späť, nie obnovovať celú
    -- databázu a prísť pritom o všetko, čo sa medzitým stalo.
    before_state  JSONB,

    triggered_by  VARCHAR(255),     -- NULL = cron
    ok            BOOLEAN NOT NULL DEFAULT FALSE,
    error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_warehouse_sync_log_time
    ON warehouse_sync_log(started_at DESC);
