-- 042: Párovanie zamestnanca na SOFTIP PAM, a oddelenie interných od externých.
--
-- Kvóty dnes prepisuje kolegyňa ručne podľa PAM. Chceme, aby si ich appka
-- čítala sama. Na to treba dve veci, ktoré v databáze zatiaľ nie sú:
--
--   1. čím človeka v PAM nájsť     -> users.personal_number (osu_os_cis)
--   2. koho tam vôbec hľadať       -> users.is_external
--
-- Externí sú zahraniční spolupracovníci, ktorí fakturujú. V PAM nie sú a
-- nikdy nebudú, takže ich kvóty zostávajú ručné presne ako doteraz. Default
-- je FALSE, teda interný - to zodpovedá tomu, ako to vyzerá dnes, a nikomu
-- sa po tejto migrácii nič nezmení.
--
-- Hodnoty z PAM pribúdajú VEDĽA našich, nie namiesto nich. Prvé nasadenie
-- ich bude len zapisovať a dá sa porovnať, či sedia s tým, čo kolegyňa
-- prepísala ručne. Až keď si to odsúhlasíme, prepne sa zdroj zobrazenej
-- kvóty - a to je zmena v kóde, nie v dátach, takže sa dá vrátiť jedným
-- nasadením bez toho, aby sa čokoľvek stratilo.

ALTER TABLE users ADD COLUMN IF NOT EXISTS personal_number INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_external BOOLEAN NOT NULL DEFAULT FALSE;

-- Jedno osobné číslo patrí jednému človeku. NULL-ov môže byť koľko chce:
-- externí ho nemajú vôbec a interní ho ešte nemusia mať doplnené. Preto
-- čiastočný index a nie UNIQUE constraint - ten by v Postgrese síce viac
-- NULL-ov pustil tiež, ale takto je zámer napísaný priamo v indexe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_personal_number
    ON users (personal_number) WHERE personal_number IS NOT NULL;

-- Čísla tak, ako ich vrátil PAM. Názvy zámerne kopírujú existujúce stĺpce
-- s predponou pam_, aby bolo porovnanie zrejmé na prvý pohľad a prepnutie
-- zdroja bolo jednoriadková zmena.
--
-- Pozor na "days" v názve pri paragrafoch: paragrafy vedieme v hodinách,
-- rovnako ako ich vedie PAM aj ako ich má dnes paragraph_days_used. Je to
-- nepresné meno, ale zavádzať druhú konvenciu vedľa prvej by bolo horšie.
ALTER TABLE employee_quotas ADD COLUMN IF NOT EXISTS pam_vacation_days_total NUMERIC(6,2);
ALTER TABLE employee_quotas ADD COLUMN IF NOT EXISTS pam_vacation_days_used  NUMERIC(6,2);
ALTER TABLE employee_quotas ADD COLUMN IF NOT EXISTS pam_paragraph_days_used NUMERIC(6,2);
ALTER TABLE employee_quotas ADD COLUMN IF NOT EXISTS pam_ocr_days_used       NUMERIC(6,2);

-- Kedy PAM naposledy odpovedal. Keď je VPN dole, synchronizácia hodnoty
-- NEVYNULUJE - nechá tam tie staré a nechá starý čas. Takto sa na obrazovke
-- pozná rozdiel medzi "PAM hovorí nula" a "PAM sa neozval".
ALTER TABLE employee_quotas ADD COLUMN IF NOT EXISTS pam_synced_at TIMESTAMP;
