-- Späť pred prepnutie zdroja kvót na PAM.
--
-- Ručné hodnoty aj pam_* stĺpce z migrácie 042 zostávajú - padá len to, čo
-- pridala 043.

DROP INDEX IF EXISTS idx_tickets_approved_quota;

ALTER TABLE tickets DROP COLUMN IF EXISTS quota_amount;

ALTER TABLE employee_quotas DROP COLUMN IF EXISTS pam_last_month;
