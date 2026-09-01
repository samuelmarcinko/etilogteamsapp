-- Migration 022: Material placements (rozdelenie tovaru na viac paletových miest)
-- Jeden materiál (unikátny kód) môže byť fyzicky uložený na viacerých
-- paletových miestach. Globálny stav (materials.quantity) = súčet placements.
--
-- POZNÁMKA: Existujúce duplicity kódov sa NESPÁJAJÚ automaticky (rieši sa ručne).
-- Tvrdý UNIQUE constraint na materials.code sa preto NEPRIDÁVA tu - pridá sa
-- samostatnou migráciou až keď budú dáta čisté. Do tej doby duplicity bráni
-- aplikačná kontrola v POST /api/warehouse/materials (409 ak kód existuje).

-- =========================================================
-- Tabuľka umiestnení
-- =========================================================
CREATE TABLE IF NOT EXISTS material_placements (
    id SERIAL PRIMARY KEY,
    material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES pallet_locations(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_placement_material_location UNIQUE (material_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_placements_material ON material_placements(material_id);
CREATE INDEX IF NOT EXISTS idx_placements_location ON material_placements(location_id);

-- =========================================================
-- Trigger (auto-update updated_at)
-- =========================================================
DROP TRIGGER IF EXISTS update_material_placements_updated_at ON material_placements;
CREATE TRIGGER update_material_placements_updated_at BEFORE UPDATE ON material_placements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- Migrácia existujúcich dát: každý materiál s priradenou pozíciou
-- dostane jeden placement (location_id, quantity).
-- =========================================================
INSERT INTO material_placements (material_id, location_id, quantity)
SELECT m.id, m.location_id, m.quantity
FROM materials m
WHERE m.location_id IS NOT NULL
ON CONFLICT (material_id, location_id) DO NOTHING;
