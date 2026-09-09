-- Undo 038.
--
-- Lokálne účty sa najprv zmažú - bez hesla by po odobratí stĺpcov zostali
-- riadky, ktorými sa nedá prihlásiť a ktoré nikto nevie vysvetliť. Ich história
-- (žiadosti, zmeny v pláne) sa viaže na user_id ako text, takže zostáva.

DELETE FROM users WHERE auth_provider = 'local';

DROP INDEX IF EXISTS uq_users_local_email;
DROP INDEX IF EXISTS idx_users_auth_provider;

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_auth_provider;
ALTER TABLE users DROP COLUMN IF EXISTS locked_until;
ALTER TABLE users DROP COLUMN IF EXISTS failed_logins;
ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;
ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;
ALTER TABLE users DROP COLUMN IF EXISTS is_active;
ALTER TABLE users DROP COLUMN IF EXISTS last_name;
ALTER TABLE users DROP COLUMN IF EXISTS first_name;
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE users DROP COLUMN IF EXISTS auth_provider;
