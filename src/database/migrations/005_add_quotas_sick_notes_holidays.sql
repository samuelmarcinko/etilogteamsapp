-- Migration 005: Add employee quotas, sick notes, and holidays tables
-- For vacation/sick day quota tracking and PN (sick note) document management

-- Slovak public holidays table
CREATE TABLE IF NOT EXISTS holidays (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    year INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Default quota settings per year
CREATE TABLE IF NOT EXISTS quota_settings (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL UNIQUE,
    default_vacation_days INTEGER NOT NULL DEFAULT 20,
    default_sick_days INTEGER NOT NULL DEFAULT 5,
    carry_over_enabled BOOLEAN DEFAULT FALSE,
    max_carry_over_days INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Individual employee quotas
CREATE TABLE IF NOT EXISTS employee_quotas (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    year INTEGER NOT NULL,
    vacation_days_total INTEGER NOT NULL DEFAULT 20,
    vacation_days_used NUMERIC(5,1) NOT NULL DEFAULT 0,
    sick_days_total INTEGER NOT NULL DEFAULT 5,
    sick_days_used NUMERIC(5,1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, year)
);

-- Sick notes (PN) document management
CREATE TABLE IF NOT EXISTS sick_notes (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    doctor_name VARCHAR(255),
    diagnosis VARCHAR(500),
    file_path VARCHAR(1000),
    file_name VARCHAR(500),
    file_type VARCHAR(50),
    file_size INTEGER,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_sick_note_status CHECK (status IN ('active', 'archived'))
);

-- Add sick-leave to ticket_type constraint if not present
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS chk_ticket_type;
ALTER TABLE tickets ADD CONSTRAINT chk_ticket_type
    CHECK (ticket_type IN ('vacation', 'sick-leave', 'purchase', 'expense', 'hr', 'other', 'HR', 'Accounting', 'Other'));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_employee_quotas_user_year ON employee_quotas(user_id, year);
CREATE INDEX IF NOT EXISTS idx_sick_notes_user ON sick_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_sick_notes_dates ON sick_notes(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_sick_notes_status ON sick_notes(status);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
CREATE INDEX IF NOT EXISTS idx_holidays_year ON holidays(year);

-- Triggers for updated_at
CREATE TRIGGER update_quota_settings_updated_at BEFORE UPDATE ON quota_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_quotas_updated_at BEFORE UPDATE ON employee_quotas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sick_notes_updated_at BEFORE UPDATE ON sick_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert Slovak holidays for 2025 and 2026
INSERT INTO holidays (date, name, year) VALUES
    ('2025-01-01', 'Deň vzniku Slovenskej republiky', 2025),
    ('2025-01-06', 'Zjavenie Pána', 2025),
    ('2025-04-18', 'Veľký piatok', 2025),
    ('2025-04-21', 'Veľkonočný pondelok', 2025),
    ('2025-05-01', 'Sviatok práce', 2025),
    ('2025-05-08', 'Deň víťazstva nad fašizmom', 2025),
    ('2025-07-05', 'Sviatok sv. Cyrila a Metoda', 2025),
    ('2025-08-29', 'Výročie SNP', 2025),
    ('2025-09-01', 'Deň Ústavy SR', 2025),
    ('2025-09-15', 'Sedembolestná Panna Mária', 2025),
    ('2025-11-01', 'Sviatok všetkých svätých', 2025),
    ('2025-11-17', 'Deň boja za slobodu a demokraciu', 2025),
    ('2025-12-24', 'Štedrý deň', 2025),
    ('2025-12-25', 'Prvý sviatok vianočný', 2025),
    ('2025-12-26', 'Druhý sviatok vianočný', 2025),
    ('2026-01-01', 'Deň vzniku Slovenskej republiky', 2026),
    ('2026-01-06', 'Zjavenie Pána', 2026),
    ('2026-04-03', 'Veľký piatok', 2026),
    ('2026-04-06', 'Veľkonočný pondelok', 2026),
    ('2026-05-01', 'Sviatok práce', 2026),
    ('2026-05-08', 'Deň víťazstva nad fašizmom', 2026),
    ('2026-07-05', 'Sviatok sv. Cyrila a Metoda', 2026),
    ('2026-08-29', 'Výročie SNP', 2026),
    ('2026-09-01', 'Deň Ústavy SR', 2026),
    ('2026-09-15', 'Sedembolestná Panna Mária', 2026),
    ('2026-11-01', 'Sviatok všetkých svätých', 2026),
    ('2026-11-17', 'Deň boja za slobodu a demokraciu', 2026),
    ('2026-12-24', 'Štedrý deň', 2026),
    ('2026-12-25', 'Prvý sviatok vianočný', 2026),
    ('2026-12-26', 'Druhý sviatok vianočný', 2026)
ON CONFLICT (date) DO NOTHING;

-- Insert default quota settings
INSERT INTO quota_settings (year, default_vacation_days, default_sick_days)
VALUES (2025, 20, 5), (2026, 20, 5)
ON CONFLICT (year) DO NOTHING;
