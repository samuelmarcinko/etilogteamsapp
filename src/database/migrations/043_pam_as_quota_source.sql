-- 043: PAM sa stáva zdrojom kvót, a žiadosť si pamätá, koľko stála.
--
-- Prepnutie zdroja je v kóde, nie v dátach. Tu pribúdajú len dve veci,
-- bez ktorých by sa nedalo povedať, čo PAM ešte nezapočítal.
--
--
-- pam_last_month
-- --------------
-- Posledný mesiac, za ktorý má PAM spracované mzdy. Nie posledný mesiac s
-- dovolenkou - berie sa cez všetky mzdové zložky, lebo kto si v septembri
-- nevzal voľno, nemá za september riadok s dovolenkou, ale výplatu dostal.
-- Podľa tohto čísla sa o každej schválenej žiadosti vie povedať, či ju PAM
-- už videl, alebo ešte nie.
--
--
-- tickets.quota_amount
-- --------------------
-- Koľko by sa za žiadosť odpočítalo: dni pri dovolenke, hodiny pri
-- paragrafoch. Appka to doteraz vypočítala pri schválení, odpočítala a
-- zahodila. Odteraz to aj uloží.
--
-- Je to to isté číslo, len si ho pamätáme - a vďaka tomu sa dá sčítať, čo
-- je schválené a PAM to ešte nespracoval, bez toho, aby sa pri každom
-- zobrazení kvóty prepočítavali pracovné dni každej žiadosti zvlášť.
--
-- Staré žiadosti zostanú s NULL. Dopočítať sa spätne nedajú (treba na to
-- kalendár sviatkov v čase schválenia) a netreba to: všetko, čo bolo
-- schválené pred prepnutím, má PAM dávno spracované.

ALTER TABLE employee_quotas ADD COLUMN IF NOT EXISTS pam_last_month SMALLINT;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS quota_amount NUMERIC(6,2);

-- Sčítanie nespracovaných beží pri každom zobrazení kvóty, teda aj v
-- zozname pre celú firmu naraz. Čiastočný index drží ten dotaz pri jednej
-- vetve namiesto prechodu cez všetky žiadosti.
CREATE INDEX IF NOT EXISTS idx_tickets_approved_quota
    ON tickets (created_by_id, ticket_type, start_date)
    WHERE status = 'Approved' AND start_date IS NOT NULL;
