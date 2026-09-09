-- 039: vyskladnenie tovaru majstrami výroby
--
-- Na poobednej smene už skladníci nie sú a majstri si materiál berú sami. Na
-- stene v sklade 02-03 visí tablet, na ňom sa vyskladní tovar a počet v appke
-- klesne. Do SAPu sa nezapisuje nič - ten opravia skladníci ručne, tak ako
-- doteraz, a rozdiel im dovtedy svieti na semafore oranžovou.
--
-- Nič sa neprepisuje ani nemaže: každý výdaj je jeden riadok navyše a storno
-- je ďalší riadok stavu, nie zmiznutý záznam.

CREATE TABLE IF NOT EXISTS warehouse_withdrawals (
    id              SERIAL PRIMARY KEY,

    material_id     INTEGER REFERENCES materials(id) ON DELETE SET NULL,
    location_id     INTEGER REFERENCES pallet_locations(id) ON DELETE SET NULL,

    -- Odpis názvov v čase výdaja. Materiál sa časom premenuje alebo zmaže a
    -- história sa nesmie stať nečitateľnou - "vzal 20 ks z (zmazané)" nie je
    -- záznam, to je hádanka.
    material_code   VARCHAR(100),
    material_name   VARCHAR(255) NOT NULL,
    location_code   VARCHAR(20)  NOT NULL,

    quantity        INTEGER NOT NULL CHECK (quantity > 0),

    -- Stav pozície pred a po. Bez toho sa storno nedá spraviť poctivo: vrátiť
    -- "o 20 viac" je iné než vrátiť "na 120", keď medzitým niekto počet upravil.
    quantity_before INTEGER,
    quantity_after  INTEGER,

    -- Vlastné položky (Tašky, Police) majú počet len ako poznámku skladníka -
    -- "1 ks" pri hromade tašiek. Pri nich sa výdaj zapíše, ale počtu sa
    -- nedotýkame, lebo odpočítavať od čísla, ktoré nikto nerátal, nemá zmysel.
    quantity_touched BOOLEAN NOT NULL DEFAULT TRUE,

    status          VARCHAR(10) NOT NULL DEFAULT 'active',

    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- `user_id` ako text, nie cudzí kľúč na users(id) - rovnako ako v celom
    -- zvyšku skladu. Účet sa môže zmeniť či vypnúť a záznam musí zostať
    -- čitateľný aj potom.
    created_by      VARCHAR(255),
    created_by_name VARCHAR(255),

    voided_at       TIMESTAMP,
    voided_by       VARCHAR(255),
    voided_by_name  VARCHAR(255),
    voided_reason   TEXT
);

ALTER TABLE warehouse_withdrawals DROP CONSTRAINT IF EXISTS chk_withdrawal_status;
ALTER TABLE warehouse_withdrawals ADD CONSTRAINT chk_withdrawal_status
    CHECK (status IN ('active', 'voided'));

-- Zoznam sa vždy číta od najnovšieho a lišta sa pýta "čo pribudlo od...".
CREATE INDEX IF NOT EXISTS idx_withdrawals_created_at ON warehouse_withdrawals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_material   ON warehouse_withdrawals(material_id);

-- PIN k tabletu
--
-- Majstri majú jeden spoločný účet - na smene je aj tak jeden človek a kto
-- vyskladnil, netreba rozlišovať. PIN nie je prihlásenie, je to zámok na
-- obrazovke: bráni tomu, aby na tablet na stene klikol ktokoľvek, kto ide okolo.
--
-- Hashuje sa rovnako ako heslo. Prečítať sa nedá ani z databázy, ani v admine -
-- dá sa len prepísať novým.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_set_at TIMESTAMP;

-- Štyri číslice sa dajú vyskúšať všetky, tak sa počítajú pokusy - rovnako ako
-- pri hesle, len s kratším zámkom, lebo tu stojí človek pri tablete a čaká.
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_pins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMP;

-- Účet tabletu sa nemá odhlasovať uprostred smeny. Platnosť prihlásenia je
-- preto dlhá; bezpečné to je preto, že pri každej požiadavke sa účet znovu
-- overuje v databáze - vypnutý účet prestane platiť okamžite, nie o rok.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_kiosk BOOLEAN NOT NULL DEFAULT FALSE;

-- Nové právo musí prejsť aj cez zoznam v databáze, nielen cez ten v kóde.
-- Bez tohto sa `warehouse.withdraw` nedá v admine prideliť žiadnej role -
-- zápis padne na CHECK a majstri sa na tablet nedostanú. Žiadny existujúci
-- riadok sa nemení, len sa rozširuje zoznam prípustných hodnôt.
ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS chk_permission_key;

ALTER TABLE role_permissions
    ADD CONSTRAINT chk_permission_key CHECK (permission_key IN (
        'hr.access',
        'hr.manage',
        'fleet.access',
        'warehouse.read',
        'warehouse.write',
        'warehouse.withdraw',
        'production.view',
        'production.manage',
        'production.notify'
    ));

-- Lišta pre skladníkov hovorí "toto pribudlo od tvojej poslednej návštevy",
-- takže si každý nesie vlastnú značku. Kompletná história je v Vyskladneniach
-- a čo treba vybaviť, vidno na semafore.
ALTER TABLE users ADD COLUMN IF NOT EXISTS withdrawals_seen_at TIMESTAMP;
