-- Migration 007: Create ticket_types table
-- Admin-managed ticket types with bilingual labels

CREATE TABLE IF NOT EXISTS ticket_types (
    id SERIAL PRIMARY KEY,
    key VARCHAR(50) UNIQUE NOT NULL,
    label_sk VARCHAR(100) NOT NULL,
    label_en VARCHAR(100) NOT NULL,
    requires_dates BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed with existing types
INSERT INTO ticket_types (key, label_sk, label_en, requires_dates, is_active, sort_order) VALUES
    ('vacation', 'Dovolenka', 'Vacation', TRUE, TRUE, 1),
    ('sick-leave', 'PN / Práceneschopnosť', 'Sick Leave', TRUE, TRUE, 2),
    ('purchase', 'Nákup', 'Purchase', FALSE, TRUE, 3),
    ('expense', 'Výdavok', 'Expense', FALSE, TRUE, 4),
    ('hr', 'HR záležitosti', 'HR Matters', FALSE, TRUE, 5),
    ('other', 'Iné', 'Other', FALSE, TRUE, 6)
ON CONFLICT (key) DO UPDATE SET
    label_sk = EXCLUDED.label_sk,
    label_en = EXCLUDED.label_en,
    requires_dates = EXCLUDED.requires_dates,
    sort_order = EXCLUDED.sort_order;

CREATE INDEX IF NOT EXISTS idx_ticket_types_active ON ticket_types(is_active);
CREATE INDEX IF NOT EXISTS idx_ticket_types_sort ON ticket_types(sort_order);
