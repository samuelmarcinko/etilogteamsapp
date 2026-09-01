-- Migration 023: Soft-delete for materials
-- Deleting a material no longer removes the row (and its placements).
-- Instead deleted_at is set; the material and its positions are hidden from
-- the map/lists but can be restored from the Movements page. Placements stay
-- intact so a restore brings the positions back exactly as they were.

ALTER TABLE materials ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255);
ALTER TABLE materials ADD COLUMN IF NOT EXISTS deleted_by_name VARCHAR(255);

-- Fast "active materials" lookups (WHERE deleted_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_materials_deleted_at ON materials(deleted_at);
