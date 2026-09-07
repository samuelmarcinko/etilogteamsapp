-- 031: a local mirror of the SAP Business One data the plan needs
--
-- The planner must keep working when the VPN drops or SAP is down, so nothing
-- in the request path is ever allowed to call SAP. A background job copies what
-- we need into these tables and the calendar reads only them. When the copy is
-- stale the screen says how stale; it does not go blank.
--
-- Everything here is a mirror: it is written only by the sync job and can be
-- dropped and rebuilt at any time. The one exception is sap_item_kinds, which
-- holds a human decision and is the only table in this migration whose contents
-- cannot be recovered from SAP.
--
-- Read-only, always. The app never writes to SAP - see services/sapClient.js,
-- where that is enforced in code rather than promised in a comment.

-- --------------------------------------------------------------- item master
CREATE TABLE IF NOT EXISTS sap_items (
    item_code             VARCHAR(50) PRIMARY KEY,
    item_name             TEXT,
    group_code            INTEGER,
    group_name            VARCHAR(120),
    -- bom_Buy = purchased, bom_Make = manufactured. This decides which question
    -- the availability check asks, so it is kept verbatim rather than mapped.
    procurement           VARCHAR(20),
    is_inventory          BOOLEAN NOT NULL DEFAULT TRUE,
    uom                   VARCHAR(30),
    on_stock              NUMERIC(16,4) NOT NULL DEFAULT 0,
    -- Quantity on open purchase orders, taken from the item rather than from a
    -- warehouse row: purchases arrive at the receiving warehouse (01-08) while
    -- production consumes from another (02-02), so the per-warehouse figure is
    -- zero exactly where it matters.
    ordered_from_vendors  NUMERIC(16,4) NOT NULL DEFAULT 0,
    synced_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sap_items_group ON sap_items(group_code);

-- ------------------------------------------------------------ stock per store
-- 27 warehouses exist but only one or two ever carry movement for a given item,
-- so only rows with something in them are kept.
CREATE TABLE IF NOT EXISTS sap_item_stock (
    item_code   VARCHAR(50) NOT NULL,
    warehouse   VARCHAR(20) NOT NULL,
    in_stock    NUMERIC(16,4) NOT NULL DEFAULT 0,
    committed   NUMERIC(16,4) NOT NULL DEFAULT 0,
    ordered     NUMERIC(16,4) NOT NULL DEFAULT 0,
    synced_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (item_code, warehouse)
);

-- ---------------------------------------------------------- production orders
-- Open orders on finished goods are what the planner picks from; open orders on
-- sub-assemblies are what tells us a bag is already being made. Both are kept,
-- distinguished by is_finished_good, because 94% of orders are sub-assemblies
-- and the planner must not see those in the list.
CREATE TABLE IF NOT EXISTS sap_production_orders (
    absolute_entry    INTEGER PRIMARY KEY,
    item_code         VARCHAR(50) NOT NULL,
    description       TEXT,
    -- SLT / TXT / GLT / KLT, read out of the order's product description. It
    -- says what kind of project this is, which changes what counts as a
    -- problem: a TXT project has no construction by design.
    project_type      VARCHAR(10),
    planned_qty       NUMERIC(16,4) NOT NULL DEFAULT 0,
    completed_qty     NUMERIC(16,4) NOT NULL DEFAULT 0,
    status            VARCHAR(30),
    warehouse         VARCHAR(20),
    start_date        DATE,
    due_date          DATE,
    is_finished_good  BOOLEAN NOT NULL DEFAULT FALSE,
    synced_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sap_orders_item ON sap_production_orders(item_code);
CREATE INDEX IF NOT EXISTS idx_sap_orders_fg   ON sap_production_orders(is_finished_good, status);

-- -------------------------------------------------------------------- the BOM
-- Two levels only, and deliberately so: the boss asked to see constructions and
-- bags, and those live at level 1 and 2. Level 3 and below is rivets, cut board
-- and printed labels, which he explicitly does not want to look at.
--
-- Rows with a NULL item_code are kept because SAP allows text-only lines and a
-- gap in line_no would be harder to read than a null.
CREATE TABLE IF NOT EXISTS sap_boms (
    parent_code   VARCHAR(50) NOT NULL,
    line_no       INTEGER NOT NULL,
    item_code     VARCHAR(50),
    item_name     TEXT,
    quantity_per  NUMERIC(16,6) NOT NULL DEFAULT 0,
    warehouse     VARCHAR(20),
    -- pit_Item, pit_Resource (labour and cost, no stock) or pit_Text.
    line_type     VARCHAR(20),
    price         NUMERIC(16,6),
    synced_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (parent_code, line_no)
);

CREATE INDEX IF NOT EXISTS idx_sap_boms_item ON sap_boms(item_code);

-- ---------------------------------------------------- what each component is
-- SAP has no field saying "this is a box" or "this is a bag", so the app guesses
-- from the group, the name and what the assembly contains, and the planner
-- corrects it. A correction is stored against the item, not the project: a
-- StackMaxx lid is a construction in every project it appears in, so it is
-- marked once and holds forever.
--
-- source distinguishes the two, and a manual row always wins over the guess -
-- see services/sapClassifier.js.
CREATE TABLE IF NOT EXISTS sap_item_kinds (
    item_code    VARCHAR(50) PRIMARY KEY,
    kind         VARCHAR(20) NOT NULL,
    source       VARCHAR(10) NOT NULL DEFAULT 'auto',
    -- Why the guess came out this way, so the planner can see whether to trust
    -- it: "group 107", "sewing below", "purchased _01 at 780 EUR".
    reason       TEXT,
    set_by       VARCHAR(255),
    set_by_name  VARCHAR(255),
    set_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_sap_kind        CHECK (kind IN ('konstrukcia', 'taska', 'ignoruj')),
    CONSTRAINT chk_sap_kind_source CHECK (source IN ('auto', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_sap_kinds_manual ON sap_item_kinds(source, kind);

-- ------------------------------------------------------------------ sync log
-- The only place that can answer "is the mirror current, and if not, why". Kept
-- small on purpose: one row per pass, trimmed by the retention service later.
CREATE TABLE IF NOT EXISTS sap_sync_log (
    id            BIGSERIAL PRIMARY KEY,
    started_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at   TIMESTAMP,
    duration_ms   INTEGER,
    orders        INTEGER NOT NULL DEFAULT 0,
    items         INTEGER NOT NULL DEFAULT 0,
    bom_lines     INTEGER NOT NULL DEFAULT 0,
    http_calls    INTEGER NOT NULL DEFAULT 0,
    ok            BOOLEAN NOT NULL DEFAULT FALSE,
    error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_sap_sync_recent ON sap_sync_log(started_at DESC);

-- --------------------------------------------------------------- the plan link
-- Which SAP production order a card is a slice of. Nullable because planning
-- ahead of SAP has to keep working: a card with no order behaves exactly as it
-- does today, it just gets no availability check.
ALTER TABLE production_plan_entries
    ADD COLUMN IF NOT EXISTS sap_order_entry INTEGER;

CREATE INDEX IF NOT EXISTS idx_entries_sap_order
    ON production_plan_entries(sap_order_entry)
 WHERE sap_order_entry IS NOT NULL;
