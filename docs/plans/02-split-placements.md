# Plán: Zákaz duplicít + rozdelenie tovaru na viac pozícií

## Problém
Skladník zadal 2× rovnaký kód (RM102482) na 2 paletové miesta (A-1, A-2) →
systém vytvoril 2 samostatné materiály s rovnakým kódom = DUPLICITA.

## Riešenie (jadro)
Jeden materiál = jeden záznam s UNIKÁTNYM kódom. Reálne umiestnenie na viac
paletových miest sa rieši cez novú tabuľku **placements** (umiestnenia).
Globálny stav = súčet kusov vo všetkých umiestneniach.

```
materials (1) ───< material_placements (N) >─── pallet_locations (1)
   RM102482              A-1: 500
   total 800            A-2: 300   →  súčet 800 = total ✓
```

---

## Databáza — migrácia 022

### 1. Nová tabuľka
```sql
CREATE TABLE material_placements (
  id SERIAL PRIMARY KEY,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES pallet_locations(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_placement UNIQUE (material_id, location_id)
);
CREATE INDEX idx_placements_material ON material_placements(material_id);
CREATE INDEX idx_placements_location ON material_placements(location_id);
```

### 2. Migrácia existujúcich dát
- Pre každý existujúci `materials` riadok → vytvor placement
  (location_id, quantity).
- **Dedup duplicít:** zoskup podľa `code`, ponechaj najnižšie `id` ako master,
  presmeruj placements + `material_movements` na master, zmaž redundantné
  master riadky. `materials.quantity` master = súčet placements.
- Až POTOM pridaj UNIQUE constraint na kód:
  ```sql
  ALTER TABLE materials ADD CONSTRAINT uq_materials_code UNIQUE (code);
  ```
  (musí byť až po deduplikácii, inak zlyhá)

### 3. `materials` tabuľka
- `code` → UNIQUE
- `quantity` zostáva ako CACHE celkového stavu (= SUM placements, validované)
- `location_id` ponechať ako "primárne miesto" (spätná kompatibilita) ALEBO
  deprecovať. Návrh: ponechať nullable, ale zdroj pravdy = placements.

---

## Backend

### Model `MaterialPlacement.js`
- `findByMaterial(materialId)` → zoznam umiestnení s kódmi lokácií
- `setPlacements(materialId, [{location_id, quantity}], user)` v transakcii:
  - validuj SUM(quantity) === material.quantity
  - validuj žiadne duplicitné location_id v poli
  - zmaž staré placements, vlož nové
  - prepočítaj/ulož materials.quantity
  - zaloguj zmeny do material_movements + audit

### Material.js zmeny
- `create()` / `update()`: kontrola unikátnosti kódu (DB constraint + friendly
  error "Kód už existuje")
- `findAll()` / `findById()`: doplniť `placements` (agregované) – napr.
  `STRING_AGG(location_code: qty)` alebo samostatný dotaz
- `findByLocationId()`: čítať cez placements (materiál sa zobrazí na každom
  mieste kde má placement, s qty pre dané miesto)

### PalletLocation.js zmeny
- `findAllWithSummary()`: count + total_quantity počítať z `material_placements`
  namiesto `materials.location_id`

### Routes
- `POST /materials` → 409 ak kód existuje
- `PUT /materials/:id` → ak telo obsahuje `placements[]`, ulož cez
  `setPlacements`; inak klasický update
- `GET /materials/:id` → vracia aj `placements`

---

## Frontend (UI/UX) — material modal

### Stav A: bez rozdelenia (default)
```
Kód *        [RM102482]
Názov *      [...]
Množstvo     [800]   Jednotka [ks]
Pozícia      [A-1            ] [🗺 Vybrať pozíciu]

[ ] Rozdeliť tovar na viac skladových pozícií
```

### Stav B: checkbox zaškrtnutý → rozdelenie
```
Množstvo (celkom)   [800]  ks   ← globálny stav, needitovateľný počas split
                                  (alebo editovateľný, prepočíta zostatok)

[x] Rozdeliť tovar na viac skladových pozícií

  Pozícia 1   [A-1   ] [🗺]   množstvo [500]   [🗑]
  Pozícia 2   [A-2   ] [🗺]   množstvo [300]   [🗑]
  [+ Pridať pozíciu]

  ┌─────────────────────────────────────────────┐
  │ Rozdelené: 800 / 800 ks   ✓ Sedí            │  ← zelené
  └─────────────────────────────────────────────┘
```
Ak nesedí:
```
  │ Rozdelené: 900 / 800 ks   ✗ Prekročené o 100 │  ← červené, Uložiť disabled
```

### Pravidlá UX
- Živý prepočet pri každej zmene množstva/pridaní riadku
- "Uložiť" disabled kým `SUM(split) !== total`
- Min. 2 riadky keď je rozdelenie zapnuté; +/- riadky dynamicky (N pozícií)
- Nedovoliť 2× tú istú pozíciu (pri výbere z mapy už obsadené sivé/skryté)
- Mapa picker pre každý riadok = existujúci `openMapPickerFS`
- Odškrtnutie checkboxu pri >1 pozícii → spýtať sa / zlúčiť späť na 1

### Validácia (frontend zrkadlí backend)
- Každé množstvo >= 0, aspoň 1 > 0
- SUM === total
- Žiadne duplicitné pozície

---

## Audit log
- `created`/`updated` material: details + `placements: [{code, qty}]`
- Pri zmene rozloženia logovať aj do `material_movements` (presun časti medzi
  miestami) – voliteľné rozšírenie

---

## i18n (SK/EN)
```
whSplitToggle: 'Rozdeliť tovar na viac skladových pozícií' / 'Split across multiple locations'
whSplitPosition: 'Pozícia' / 'Position'
whSplitAllocated: 'Rozdelené' / 'Allocated'
whSplitMatch: 'Sedí' / 'Matches'
whSplitOver: 'Prekročené o {n}' / 'Over by {n}'
whSplitUnder: 'Chýba {n}' / 'Missing {n}'
whSplitAddPosition: 'Pridať pozíciu' / 'Add position'
whSplitDuplicateLoc: 'Pozícia už použitá' / 'Position already used'
whCodeExists: 'Materiál s týmto kódom už existuje' / 'Material with this code already exists'
whTotalQuantity: 'Množstvo (celkom)' / 'Total quantity'
```

---

## Súbory
| Súbor | Zmena |
|-------|-------|
| `migrations/022_add_material_placements.sql` | tabuľka + dedup + UNIQUE code |
| `src/database/models/MaterialPlacement.js` | nový model |
| `src/database/models/Material.js` | unikátnosť kódu, placements v select |
| `src/database/models/PalletLocation.js` | summary cez placements |
| `src/routes/warehouseRoutes.js` | placements v POST/PUT/GET, 409 |
| `public/portal/assets/js/portal.js` | split UI v modali, validácia |
| `public/portal/assets/js/portalI18n.js` | preklady |
| `public/portal/assets/css/portal.css` | štýly split riadkov, indikátor |

---

## Poradie implementácie
1. Migrácia (tabuľka + dedup existujúcich duplicít + UNIQUE)
2. Modely (MaterialPlacement, úpravy Material/PalletLocation)
3. Routes
4. Frontend modal split UI + živá validácia
5. i18n + CSS
6. Test: vytvor RM s 800 → rozdeľ 500/300 → over mapu, location modal, summary

## ROZHODNUTÉ
1. **Množstvo počas split**: total FIXNÝ hore (kotva = koľko reálne prišlo).
   Riadky sa musia rovnať total. Skladník nepočíta — každý nový riadok sa
   AUTO-predvyplní zvyšným zostatkom. Indikátor "Zostáva rozdeliť: N".
   Uložiť disabled kým SUM(riadky) !== total.
2. **Existujúce duplicity**: NECHAŤ, používateľ rieši ručne. Migrácia teda:
   - pridá `material_placements` + skopíruje existujúce (location_id, quantity)
   - NEROBÍ auto-merge a NEPRIDÁVA hneď DB UNIQUE (zlyhalo by na duploch)
   - ochrana proti NOVÝM dupliciam = aplikačná kontrola v POST (409)
   - tvrdý `ALTER TABLE ... ADD CONSTRAINT uq_materials_code UNIQUE` pridať
     AŽ neskôr, keď budú dáta čisté
   - split UI slúži ako nástroj na ručný merge starých duplicít

## Závislosť: Stock IN/OUT (plán 01)
Po zlúčení oboch: stock IN/OUT pôjde na úrovni konkrétneho placementu.
