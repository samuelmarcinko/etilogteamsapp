-- Migration: Increase decimal precision from 1 to 2 decimal places
-- This fixes rounding issues where values like 3.58 were being rounded to 3.6

-- Update employee_quotas columns
ALTER TABLE employee_quotas
ALTER COLUMN vacation_days_total TYPE NUMERIC(5,2);

ALTER TABLE employee_quotas
ALTER COLUMN vacation_days_used TYPE NUMERIC(5,2);

ALTER TABLE employee_quotas
ALTER COLUMN sick_days_total TYPE NUMERIC(5,2);

ALTER TABLE employee_quotas
ALTER COLUMN sick_days_used TYPE NUMERIC(5,2);

ALTER TABLE employee_quotas
ALTER COLUMN paragraph_days_total TYPE NUMERIC(5,2);

ALTER TABLE employee_quotas
ALTER COLUMN paragraph_days_used TYPE NUMERIC(5,2);

ALTER TABLE employee_quotas
ALTER COLUMN ocr_days_total TYPE NUMERIC(5,2);

ALTER TABLE employee_quotas
ALTER COLUMN ocr_days_used TYPE NUMERIC(5,2);

-- Update quota_settings columns
ALTER TABLE quota_settings
ALTER COLUMN default_vacation_days TYPE NUMERIC(5,2);

ALTER TABLE quota_settings
ALTER COLUMN default_sick_days TYPE NUMERIC(5,2);

ALTER TABLE quota_settings
ALTER COLUMN default_paragraph_days TYPE NUMERIC(5,2);

ALTER TABLE quota_settings
ALTER COLUMN default_ocr_days TYPE NUMERIC(5,2);

ALTER TABLE quota_settings
ALTER COLUMN max_carry_over_days TYPE NUMERIC(5,2);
