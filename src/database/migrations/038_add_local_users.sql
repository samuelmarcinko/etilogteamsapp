-- 038: používatelia s vlastným heslom
--
-- Do výrobného plánu treba pozvať aj dodávateľov zvonku a tí firemné M365
-- nemajú. Doteraz sa do portálu dalo dostať výhradne cez Azure AD - toto je
-- druhá cesta dnu, a preto sa s ňou zaobchádza opatrne.
--
-- Existujúcich používateľov sa to nedotkne: dostanú auth_provider = 'azure' a
-- prihlasujú sa presne ako doteraz. Heslo majú NULL a nikdy sa im nenastaví -
-- účet napojený na M365 nemá mať druhé, slabšie dvere.

ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(10) NOT NULL DEFAULT 'azure';
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_auth_provider;
ALTER TABLE users ADD CONSTRAINT chk_users_auth_provider CHECK (auth_provider IN ('azure', 'local'));

-- scrypt: soľ aj parametre sú uložené v tom istom reťazci, aby sa dali časom
-- zosilniť bez toho, aby staré heslá prestali fungovať.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Meno a priezvisko zvlášť. `display_name` od Azure je jeden reťazec a pri
-- ručne zakladanom účte niet dôvodu ho takto zlepovať.
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name  VARCHAR(100);

-- Vypnutý účet sa nemaže: história žiadostí a zmien v pláne musí zostať
-- čitateľná aj potom, ako dodávateľ prestane spolupracovať.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Heslo nastavené administrátorom platí na jedno prihlásenie; potom si ho
-- človek musí zmeniť. Admin tak nikdy nepozná heslo, ktorým sa niekto reálne
-- prihlasuje.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;

-- Zámok proti hádaniu hesla. M365 to rieši za nás; pri vlastných heslách by
-- sme bez tohto vyvesili na verejnú adresu dvere bez zámku.
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until  TIMESTAMP;

-- E-mail je pri lokálnom účte prihlasovacie meno, takže musí byť jedinečný -
-- ale len medzi lokálnymi účtami. Azure účty majú e-maily z historických
-- dôvodov duplicitné a tento index sa ich nesmie dotknúť.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_local_email
    ON users (lower(email)) WHERE auth_provider = 'local';

CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users(auth_provider);
