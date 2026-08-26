-- Migration 025: Production Plan module (Výrobný plán)
--
-- Core schema per section 3 of docs/ETILOG_Production_Module_Plan.md.
-- Replaces Productiondistributor.xlsx: 12 production sheets, ~2700 weekly
-- blocks, 2018-2027.
--
-- Scope note: this covers the planner itself - locations, shifts, products,
-- plan entries, day flags and calendar exceptions. The draft/publish tables
-- (production_weeks, production_week_revisions), the append-only change log and
-- the notification/outbox tables are deliberately left for the migration that
-- introduces the features that use them, rather than guessed at now.
--
-- Rollback: 025_add_production_down.sql

-- =========================================================
-- Locations (one per Excel sheet)
-- =========================================================
-- The sheet header carries capacity data - production line, headcount, gross
-- and net daily hours, supervisor - which is worth keeping for later capacity
-- planning even though nothing reads it yet.
CREATE TABLE IF NOT EXISTS production_locations (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(50) NOT NULL UNIQUE,   -- stable key, e.g. "PO1"
    name         VARCHAR(100) NOT NULL,         -- display name
    is_internal  BOOLEAN NOT NULL DEFAULT TRUE, -- false for external partners
    is_active    BOOLEAN NOT NULL DEFAULT TRUE, -- inactive stays searchable
    sort_order   INTEGER NOT NULL DEFAULT 0,

    -- capacity metadata from the sheet header
    line_name    VARCHAR(100),
    headcount    INTEGER,
    gross_hours  NUMERIC(6,2),
    net_hours    NUMERIC(6,2),
    supervisor   VARCHAR(100),

    notes        TEXT,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- Shifts - flexible, not hardcoded morning/afternoon
-- =========================================================
-- Per location, so adding a Night shift later is a settings change rather than
-- a schema change. Older Excel weeks carry a third Produkt/Soll pair for
-- prototypes, which imports as its own shift.
CREATE TABLE IF NOT EXISTS production_shifts (
    id          SERIAL PRIMARY KEY,
    location_id INTEGER NOT NULL REFERENCES production_locations(id) ON DELETE CASCADE,
    name        VARCHAR(50) NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_shift_per_location UNIQUE (location_id, name)
);

-- =========================================================
-- Products (FG master)
-- =========================================================
-- Populated from the Excel import by deduplicating FG prefixes. Free-text
-- production (TESLA ABD, Daimler B-Säule) needs no row here - it lives in
-- production_plan_entries.custom_product_name.
CREATE TABLE IF NOT EXISTS products (
    id            SERIAL PRIMARY KEY,
    fg_number     VARCHAR(50) NOT NULL UNIQUE,  -- parsed ^FG\d+
    description   TEXT,                          -- remainder of the long string
    sap_item_code VARCHAR(50),                   -- for the future SAP adapter
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_fg_number ON products(fg_number);

-- =========================================================
-- Plan entries - the core table
-- =========================================================
-- Deliberately NO unique constraint on (location, date, shift, product): a slot
-- can hold several cards. The real data already does this, and the UI showing
-- one by default is a display choice, not a storage one.
CREATE TABLE IF NOT EXISTS production_plan_entries (
    id              SERIAL PRIMARY KEY,
    location_id     INTEGER NOT NULL REFERENCES production_locations(id) ON DELETE CASCADE,
    production_date DATE NOT NULL,
    shift_id        INTEGER REFERENCES production_shifts(id) ON DELETE SET NULL,

    -- either an FG from the master table, or free text. Not both, not neither.
    product_id           INTEGER REFERENCES products(id) ON DELETE SET NULL,
    custom_product_name  TEXT,

    -- clean number for reporting and SAP, plus the original string so nothing
    -- from the import is lost ("130+22" -> 152 + {"parts":[130,22]} + "130+22")
    planned_quantity   NUMERIC(12,2),
    quantity_breakdown JSONB,
    raw_quantity       TEXT,

    priority   VARCHAR(20) NOT NULL DEFAULT 'normal',
    status     VARCHAR(20) NOT NULL DEFAULT 'planned',
    notes      TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,      -- card order within one slot

    -- import fidelity: which cell did this come from
    source_sheet VARCHAR(100),
    source_cell  VARCHAR(20),
    source_file  VARCHAR(255),

    created_by      VARCHAR(255),
    created_by_name VARCHAR(255),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by      VARCHAR(255),
    updated_by_name VARCHAR(255),
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    version    INTEGER NOT NULL DEFAULT 1,      -- optimistic concurrency
    deleted_at TIMESTAMP,                       -- soft delete

    CONSTRAINT chk_entry_priority CHECK (priority IN ('normal', 'high', 'urgent', 'blocked')),
    CONSTRAINT chk_entry_status   CHECK (status IN ('planned', 'in_progress', 'done', 'cancelled')),
    CONSTRAINT chk_entry_product  CHECK (
        (product_id IS NOT NULL AND custom_product_name IS NULL) OR
        (product_id IS NULL AND custom_product_name IS NOT NULL)
    )
);

-- The planner always reads a location over a date range, so lead with those.
-- Partial on deleted_at because soft-deleted rows are never in that view.
CREATE INDEX IF NOT EXISTS idx_plan_entries_location_date
    ON production_plan_entries(location_id, production_date)
    WHERE deleted_at IS NULL;

-- History search goes the other way: one FG across every location and date.
CREATE INDEX IF NOT EXISTS idx_plan_entries_product
    ON production_plan_entries(product_id, production_date DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_entries_shift ON production_plan_entries(shift_id);

-- =========================================================
-- Day flags - whole-day state, not per-slot
-- =========================================================
-- Replaces the coloured Excel columns: green FREE is a property of the day, and
-- "mark day as critical" tints the whole column. One flag per day per location.
CREATE TABLE IF NOT EXISTS production_day_flags (
    id              SERIAL PRIMARY KEY,
    location_id     INTEGER NOT NULL REFERENCES production_locations(id) ON DELETE CASCADE,
    production_date DATE NOT NULL,
    flag            VARCHAR(20) NOT NULL,
    note            TEXT,
    created_by      VARCHAR(255),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_day_flag UNIQUE (location_id, production_date),
    CONSTRAINT chk_day_flag CHECK (flag IN ('free', 'critical', 'urgent'))
);

-- =========================================================
-- Calendar exceptions
-- =========================================================
-- Default working calendar plus exceptions. No "Saturday and Sunday are always
-- off" rule: the real data has Saturday production. A NULL location_id means
-- the exception applies everywhere (national holidays from the BANK HOLIDAYS
-- sheet).
CREATE TABLE IF NOT EXISTS production_calendar_exceptions (
    id              SERIAL PRIMARY KEY,
    location_id     INTEGER REFERENCES production_locations(id) ON DELETE CASCADE,
    exception_date  DATE NOT NULL,
    type            VARCHAR(30) NOT NULL,
    note            TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_calendar_type CHECK (type IN ('holiday', 'shutdown', 'extra_working_day'))
);

CREATE INDEX IF NOT EXISTS idx_calendar_exceptions_date
    ON production_calendar_exceptions(exception_date);

-- =========================================================
-- updated_at triggers (function comes from schema.sql)
-- =========================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_production_locations_updated ON production_locations;
CREATE TRIGGER trg_production_locations_updated BEFORE UPDATE ON production_locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_production_shifts_updated ON production_shifts;
CREATE TRIGGER trg_production_shifts_updated BEFORE UPDATE ON production_shifts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_products_updated ON products;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_plan_entries_updated ON production_plan_entries;
CREATE TRIGGER trg_plan_entries_updated BEFORE UPDATE ON production_plan_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_day_flags_updated ON production_day_flags;
CREATE TRIGGER trg_day_flags_updated BEFORE UPDATE ON production_day_flags
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- Seed: the twelve locations from the Excel workbook
-- =========================================================
-- Ranges and headcount come from the sheet headers; DS-2 is historical only.
INSERT INTO production_locations (code, name, is_internal, is_active, sort_order) VALUES
    ('PO1',           'PO1',               TRUE,  TRUE,  10),
    ('DS1',           'DS-1',              TRUE,  TRUE,  20),
    ('KANDRAC',       'Kandrac',           FALSE, TRUE,  30),
    ('MIRAND1',       'Mirand 1',          FALSE, TRUE,  40),
    ('MIRAND2',       'Mirand 2',          FALSE, TRUE,  50),
    ('PARADA',        'Parada',            FALSE, TRUE,  60),
    ('TEXOPS_PO1',    'TexOps PO1',        TRUE,  TRUE,  70),
    ('ASSEMBLY_PO1',  'Assembly PO1',      TRUE,  TRUE,  80),
    ('ASSEMBLY_ASPF', 'Assembly ASPF',     TRUE,  TRUE,  90),
    ('ASSEMBLY_PO2',  'Assembly PO2 VIET', TRUE,  TRUE, 100),
    ('PROT_AREA',     'Prot. Area',        TRUE,  TRUE, 110),
    ('DS2',           'DS-2',              TRUE,  FALSE, 120)
ON CONFLICT (code) DO NOTHING;

UPDATE production_locations
   SET line_name = 'Presov', headcount = 58, gross_hours = 435, net_hours = 390
 WHERE code = 'PO1' AND line_name IS NULL;

-- Two shifts everywhere to start. A third (Night, or Prototype for the older
-- imported weeks) is added per location without touching the schema.
INSERT INTO production_shifts (location_id, name, sort_order)
SELECT l.id, s.name, s.sort_order
FROM production_locations l
CROSS JOIN (VALUES ('Morning', 10), ('Afternoon', 20)) AS s(name, sort_order)
ON CONFLICT (location_id, name) DO NOTHING;
