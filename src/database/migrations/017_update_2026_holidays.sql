-- Migration 017: Update 2026 Slovak holidays to correct list
-- Removes extra holidays and keeps only the official 11 state holidays

-- First, delete all 2026 holidays
DELETE FROM holidays WHERE year = 2026;

-- Insert the correct 2026 Slovak holidays (11 total)
INSERT INTO holidays (date, name, year) VALUES
    ('2026-01-01', 'Deň vzniku Slovenskej republiky', 2026),
    ('2026-01-06', 'Zjavenie Pána (Traja králi)', 2026),
    ('2026-04-03', 'Veľký piatok', 2026),
    ('2026-04-06', 'Veľkonočný pondelok', 2026),
    ('2026-05-01', 'Sviatok práce', 2026),
    ('2026-07-05', 'Sviatok svätých Cyrila a Metoda', 2026),
    ('2026-08-29', 'Výročie SNP', 2026),
    ('2026-11-01', 'Sviatok všetkých svätých', 2026),
    ('2026-12-24', 'Štedrý deň', 2026),
    ('2026-12-25', 'Prvý sviatok vianočný', 2026),
    ('2026-12-26', 'Druhý sviatok vianočný', 2026)
ON CONFLICT (date) DO UPDATE SET name = EXCLUDED.name;
