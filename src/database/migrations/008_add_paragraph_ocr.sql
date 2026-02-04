-- Migration 008: Replace sick days with Paragraph and OCR quotas
-- Each employee gets max 7 Paragraph days and 7 OCR days per year
-- Sick notes now have a document_type field (paragraph or ocr)

-- Add document_type to sick_notes
ALTER TABLE sick_notes ADD COLUMN IF NOT EXISTS document_type VARCHAR(20) DEFAULT 'paragraph';

-- Add paragraph and OCR columns to employee_quotas
ALTER TABLE employee_quotas ADD COLUMN IF NOT EXISTS paragraph_days_total INTEGER NOT NULL DEFAULT 7;
ALTER TABLE employee_quotas ADD COLUMN IF NOT EXISTS paragraph_days_used NUMERIC(5,1) NOT NULL DEFAULT 0;
ALTER TABLE employee_quotas ADD COLUMN IF NOT EXISTS ocr_days_total INTEGER NOT NULL DEFAULT 7;
ALTER TABLE employee_quotas ADD COLUMN IF NOT EXISTS ocr_days_used NUMERIC(5,1) NOT NULL DEFAULT 0;

-- Add paragraph and OCR defaults to quota_settings
ALTER TABLE quota_settings ADD COLUMN IF NOT EXISTS default_paragraph_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE quota_settings ADD COLUMN IF NOT EXISTS default_ocr_days INTEGER NOT NULL DEFAULT 7;

-- Update existing quota_settings rows with defaults
UPDATE quota_settings SET default_paragraph_days = 7, default_ocr_days = 7
WHERE default_paragraph_days IS NULL OR default_ocr_days IS NULL;
