-- Migration 024: Role -> permission matrix (data model only)
--
-- Access is currently one exclusive string in users.role, hardcoded in
-- hasModuleAccess() on the frontend and requireDbRole(...) per API route.
-- This adds the tables an admin-managed matrix needs. Nothing reads them yet:
-- no existing table is altered and no users.role value is touched, so applying
-- this migration changes no behaviour whatsoever.
--
-- The seed is an exact transcription of today's rules, so that when the
-- resolver is switched on it produces identical answers:
--
--   hasModuleAccess()          admin -> every module
--                              hr    -> every role
--                              fleet -> admin only
--                              warehouse -> sklad, sklad_read
--   canEditWarehouse()         admin, sklad
--   requireDbRole('admin','spravca')  -> 12 HR routes (adminRoutes,
--                                        quotaRoutes, sickNoteRoutes)
--
-- That last one is why hr.manage exists as a separate key: spravca and user
-- both have HR access, but only spravca reaches employees, quotas, sick notes
-- and the ticket overview. Collapsing them onto hr.access alone would either
-- strip spravca of those rights or hand them to everyone.
--
-- Rollback: 024_add_roles_permissions_down.sql

-- =========================================================
-- Roles
-- =========================================================
-- name  = the string stored in users.role; immutable once created, because
--         users.role references it by value and renaming would orphan users.
-- label = display name, editable. System roles are rendered from the portal's
--         i18n dictionary instead, so their SK/EN labels keep working; this is
--         the fallback and the only label custom roles have.
CREATE TABLE IF NOT EXISTS roles (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(50) NOT NULL UNIQUE,
    label      VARCHAR(100) NOT NULL,
    is_system  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- Role -> permission matrix
-- =========================================================
-- One row per granted checkbox. Absence of a row means "not granted".
-- hr.access is granted to every role in the seed and is additionally forced on
-- by the resolver, so HR can never be switched off for anyone.
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id        INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_key VARCHAR(50) NOT NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_key),
    CONSTRAINT chk_permission_key CHECK (permission_key IN (
        'hr.access',
        'hr.manage',
        'fleet.access',
        'warehouse.read',
        'warehouse.write',
        'production.view',
        'production.manage'
    ))
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);

-- Reuse the shared trigger function from schema.sql (CREATE OR REPLACE, so this
-- is a no-op where it already exists).
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_roles_updated_at ON roles;
CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- Seed: the five roles that exist today, locked as system roles
-- =========================================================
INSERT INTO roles (name, label, is_system) VALUES
    ('user',       'Používateľ',          TRUE),
    ('spravca',    'Správca',             TRUE),
    ('sklad',      'Správca skladu',      TRUE),
    ('sklad_read', 'Sklad (len čítanie)', TRUE),
    ('admin',      'Administrátor',       TRUE)
ON CONFLICT (name) DO NOTHING;

-- =========================================================
-- Seed: today's access, transcribed exactly
-- =========================================================
-- admin is listed in full even though the resolver short-circuits it, so the
-- admin checkbox matrix renders as all-ticked rather than all-empty.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
JOIN (VALUES
    -- every role has HR
    ('user',       'hr.access'),
    ('spravca',    'hr.access'),
    ('sklad',      'hr.access'),
    ('sklad_read', 'hr.access'),
    ('admin',      'hr.access'),

    -- HR management: employees, quotas, sick notes, ticket overview
    ('spravca',    'hr.manage'),
    ('admin',      'hr.manage'),

    -- warehouse: sklad reads and writes, sklad_read only reads
    ('sklad',      'warehouse.read'),
    ('sklad',      'warehouse.write'),
    ('sklad_read', 'warehouse.read'),
    ('admin',      'warehouse.read'),
    ('admin',      'warehouse.write'),

    -- fleet is admin-only today; no other role gets it
    ('admin',      'fleet.access'),

    -- production does not exist yet; only admin is pre-granted
    ('admin',      'production.view'),
    ('admin',      'production.manage')
) AS p(role_name, permission_key) ON p.role_name = r.name
ON CONFLICT DO NOTHING;
