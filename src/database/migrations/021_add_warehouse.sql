-- Migration 021: Warehouse module (Skladový systém)
-- Adds material categories, pallet locations (seeded), materials,
-- material movement history and warehouse audit log.
-- Pallet locations mirror the interactive SVG map zones:
--   MINI(1), D(20), A(32), B(32), C(34) = 119 locations.

-- =========================================================
-- Material categories
-- =========================================================
CREATE TABLE IF NOT EXISTS material_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    color VARCHAR(20) DEFAULT '#3b82f6',
    icon VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- Pallet locations (zones on the warehouse map)
-- =========================================================
CREATE TABLE IF NOT EXISTS pallet_locations (
    id SERIAL PRIMARY KEY,
    zone VARCHAR(10) NOT NULL,          -- MINI, D, A, B, C
    position INTEGER NOT NULL,          -- 1..N within zone
    code VARCHAR(20) NOT NULL UNIQUE,   -- e.g. "A-15", "D-3", "MINI-1"
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_pallet_zone_pos UNIQUE (zone, position)
);

-- =========================================================
-- Materials
-- =========================================================
CREATE TABLE IF NOT EXISTS materials (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) NOT NULL,         -- manually entered (not SAP-linked)
    name VARCHAR(255) NOT NULL,
    description TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    unit VARCHAR(20) DEFAULT 'ks',
    location_id INTEGER REFERENCES pallet_locations(id) ON DELETE SET NULL,
    category_id INTEGER REFERENCES material_categories(id) ON DELETE SET NULL,
    created_by VARCHAR(255),
    created_by_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- Material movements (relocation history)
-- =========================================================
CREATE TABLE IF NOT EXISTS material_movements (
    id SERIAL PRIMARY KEY,
    material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    from_location_id INTEGER REFERENCES pallet_locations(id) ON DELETE SET NULL,
    to_location_id INTEGER REFERENCES pallet_locations(id) ON DELETE SET NULL,
    moved_by VARCHAR(255),
    moved_by_name VARCHAR(255),
    reason TEXT,
    moved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- Warehouse audit log (admin only)
-- =========================================================
CREATE TABLE IF NOT EXISTS warehouse_audit_log (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255),
    user_name VARCHAR(255),
    action VARCHAR(50) NOT NULL,        -- created, updated, deleted, moved
    entity VARCHAR(50) NOT NULL,        -- material, category, location
    entity_id INTEGER,
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- Indexes
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_materials_code ON materials(code);
CREATE INDEX IF NOT EXISTS idx_materials_location ON materials(location_id);
CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category_id);
CREATE INDEX IF NOT EXISTS idx_materials_name ON materials(name);
CREATE INDEX IF NOT EXISTS idx_pallet_locations_zone ON pallet_locations(zone);
CREATE INDEX IF NOT EXISTS idx_material_movements_material ON material_movements(material_id);
CREATE INDEX IF NOT EXISTS idx_material_movements_moved_at ON material_movements(moved_at DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_audit_created_at ON warehouse_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_audit_entity ON warehouse_audit_log(entity, entity_id);

-- =========================================================
-- Triggers (auto-update updated_at)
-- =========================================================
DROP TRIGGER IF EXISTS update_material_categories_updated_at ON material_categories;
CREATE TRIGGER update_material_categories_updated_at BEFORE UPDATE ON material_categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pallet_locations_updated_at ON pallet_locations;
CREATE TRIGGER update_pallet_locations_updated_at BEFORE UPDATE ON pallet_locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_materials_updated_at ON materials;
CREATE TRIGGER update_materials_updated_at BEFORE UPDATE ON materials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- Seed pallet locations (119 total, mirrors the SVG map)
-- =========================================================
INSERT INTO pallet_locations (zone, position, code)
SELECT 'MINI', 1, 'MINI-1'
UNION ALL SELECT 'D', g, 'D-' || g FROM generate_series(1, 20) AS g
UNION ALL SELECT 'A', g, 'A-' || g FROM generate_series(1, 32) AS g
UNION ALL SELECT 'B', g, 'B-' || g FROM generate_series(1, 32) AS g
UNION ALL SELECT 'C', g, 'C-' || g FROM generate_series(1, 34) AS g
ON CONFLICT (code) DO NOTHING;

-- =========================================================
-- Seed default material categories
-- =========================================================
INSERT INTO material_categories (name, color, icon) VALUES
    ('Oceľ',       '#64748b', 'cube'),
    ('Hliník',     '#3b82f6', 'cube'),
    ('Spojovací materiál', '#f59e0b', 'wrench'),
    ('Plast',      '#22c55e', 'cube'),
    ('Ostatné',    '#a855f7', 'box')
ON CONFLICT (name) DO NOTHING;
