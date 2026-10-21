-- Migration 040: OČR sa volá Paragraf - sprievod, Paragraf sa volá Paragraf - lekár
--
-- V systéme nie je a nebude ošetrenie člena rodiny. To, čo sa doteraz volalo
-- OČR, je paragraf na sprievod rodinného príslušníka na ošetrenie - iný nárok
-- a iný zákon. Kvóty na to už sú nahodené pod starým menom, takže tu sa
-- nemení nič okrem textu, ktorý ľudia vidia.
--
-- Kľúče `paragraph` a `ocr` zostávajú. Sú to vnútorné identifikátory, ktoré sa
-- na obrazovku nikdy nedostanú, a visia na nich živé dáta vo štyroch
-- tabuľkách: `tickets.ticket_type`, `sick_notes.document_type` a stĺpce
-- `ocr_days_total` / `ocr_days_used` v `employee_quotas` aj `quota_settings`.
-- Premenovať ich by znamenalo prepísať podané žiadosti, nahrané doklady a
-- nazbierané kvóty naprieč celým modulom - a jediné, čo by sa tým získalo, je
-- krajšie slovo v stĺpci, ktorý nikto nečíta. Meno, ktoré vidno, je v
-- `ticket_types.label_sk` a `label_en`, a práve to sa tu prepisuje.
--
-- Rollback: 040_rename_ocr_to_escort_down.sql

UPDATE ticket_types
   SET label_sk = 'Paragraf - lekár',
       label_en = 'Doctor''s Appointment',
       updated_at = CURRENT_TIMESTAMP
 WHERE key = 'paragraph';

UPDATE ticket_types
   SET label_sk = 'Paragraf - sprievod',
       label_en = 'Family Member Escort',
       updated_at = CURRENT_TIMESTAMP
 WHERE key = 'ocr';

-- Keby sa migrácia púšťala na databáze, ktorá tie dva typy ešte nemá - čistá
-- inštalácia, kde migrácia 009 z akéhokoľvek dôvodu nedobehla - `UPDATE` nad
-- ňou neurobí nič a typ by chýbal. Toto ho doplní so správnym menom rovno.
INSERT INTO ticket_types (key, label_sk, label_en, requires_dates, is_active, sort_order)
VALUES ('paragraph', 'Paragraf - lekár',    'Doctor''s Appointment', TRUE, TRUE, 2),
       ('ocr',       'Paragraf - sprievod', 'Family Member Escort',  TRUE, TRUE, 3)
ON CONFLICT (key) DO NOTHING;
