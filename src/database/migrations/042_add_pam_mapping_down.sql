-- Späť na stav pred párovaním na PAM.
--
-- Ručné kvóty (vacation_days_*, paragraph_days_*, ocr_days_*, sick_days_*)
-- sa nedotýkame - tie tu boli predtým a zostávajú. Padá len to, čo pridala
-- migrácia 042.

DROP INDEX IF EXISTS idx_users_personal_number;

ALTER TABLE users DROP COLUMN IF EXISTS personal_number;
ALTER TABLE users DROP COLUMN IF EXISTS is_external;

ALTER TABLE employee_quotas DROP COLUMN IF EXISTS pam_vacation_days_total;
ALTER TABLE employee_quotas DROP COLUMN IF EXISTS pam_vacation_days_used;
ALTER TABLE employee_quotas DROP COLUMN IF EXISTS pam_paragraph_days_used;
ALTER TABLE employee_quotas DROP COLUMN IF EXISTS pam_ocr_days_used;
ALTER TABLE employee_quotas DROP COLUMN IF EXISTS pam_synced_at;
