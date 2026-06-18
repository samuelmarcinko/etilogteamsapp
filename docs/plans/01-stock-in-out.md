# Plán: Naskladnenie / Vyskladnenie (Stock IN/OUT)

## Cieľ
Zamestnanec zaznamená odber materiálu pre výrobu (vyskladnenie) a príjem
materiálu / vratku (naskladnenie). Všetko logované v Pohyboch + audit logu.

## Databáza — nová tabuľka `stock_transactions`
```sql
CREATE TABLE stock_transactions (
  id SERIAL PRIMARY KEY,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL,           -- 'in' | 'out'
  quantity INTEGER NOT NULL,           -- vždy kladné
  quantity_before INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  reason VARCHAR(100),                  -- production|return|delivery|adjustment|other
  note TEXT,
  location_id INTEGER REFERENCES pallet_locations(id),
  created_by VARCHAR(255),
  created_by_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
Movements = KDE (lokácia), Transactions = KOĽKO (množstvo). Oddelené.

## Backend
- `POST /api/warehouse/materials/:id/stock-out` { quantity, reason, note? }
- `POST /api/warehouse/materials/:id/stock-in`  { quantity, reason, note? }
- `GET  /api/warehouse/stock-transactions?material_id=&type=&from=&to=`
- Model `StockTransaction.js` + `Material.adjustStock()` (FOR UPDATE lock)

## Frontend
- Rýchle `[+]` `[-]` tlačidlá pri každom materiáli → modal (typ, množstvo,
  dôvod, poznámka, live "nový stav")
- Rovnaké +/- v location modali
- História v #warehouse-movements (zlúčený zoznam s ikonami: 📍 presun,
  📦⬆️ naskladnenie, 📦⬇️ vyskladnenie)
- Audit log akcie: `stock_in`, `stock_out`

## Validácie
- Vyskladnenie max = aktuálny stav (nejde do mínusu)
- DB lock proti race condition

## POZNÁMKA: závislosť na pláne 02
Po zavedení rozdelenia na pozície (plán 02 – placements) bude stock IN/OUT
pracovať na úrovni PLACEMENTU (konkrétne paletové miesto), nie len globálne.
Implementovať plán 02 PRED týmto, alebo zladiť oba.
