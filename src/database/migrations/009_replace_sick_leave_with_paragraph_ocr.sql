-- Migration 009: Replace sick-leave ticket type with paragraph and ocr
-- OČR = Ošetrenie člena rodiny = Family Member Care

-- Deactivate old sick-leave ticket type
UPDATE ticket_types SET is_active = FALSE WHERE key = 'sick-leave';

-- Insert paragraph ticket type
INSERT INTO ticket_types (key, label_sk, label_en, requires_dates, is_active, sort_order) VALUES
    ('paragraph', 'Paragraf', 'Paragraph Leave', TRUE, TRUE, 2),
    ('ocr', 'OČR (Ošetrenie člena rodiny)', 'Family Member Care', TRUE, TRUE, 3)
ON CONFLICT (key) DO UPDATE SET
    label_sk = EXCLUDED.label_sk,
    label_en = EXCLUDED.label_en,
    requires_dates = EXCLUDED.requires_dates,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order;

-- Re-order remaining types after the new ones
UPDATE ticket_types SET sort_order = 4 WHERE key = 'purchase';
UPDATE ticket_types SET sort_order = 5 WHERE key = 'expense';
UPDATE ticket_types SET sort_order = 6 WHERE key = 'hr';
UPDATE ticket_types SET sort_order = 7 WHERE key = 'other';

-- Update CHECK constraint to allow paragraph and ocr ticket types
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS chk_ticket_type;
ALTER TABLE tickets ADD CONSTRAINT chk_ticket_type
    CHECK (ticket_type IN ('vacation', 'sick-leave', 'purchase', 'expense', 'hr', 'other', 'HR', 'Accounting', 'Other', 'paragraph', 'ocr'));
