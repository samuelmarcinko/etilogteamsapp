-- Rollback 040: späť na pôvodné názvy typov žiadostí.
--
-- Vracia len text. Kľúče sa nemenili, takže žiadne žiadosti, doklady ani
-- kvóty sa tým nedotknú - rovnako ako pri migrácii samotnej.

UPDATE ticket_types
   SET label_sk = 'Paragraf',
       label_en = 'Paragraph Leave',
       updated_at = CURRENT_TIMESTAMP
 WHERE key = 'paragraph';

UPDATE ticket_types
   SET label_sk = 'OČR (Ošetrenie člena rodiny)',
       label_en = 'Family Member Care',
       updated_at = CURRENT_TIMESTAMP
 WHERE key = 'ocr';
