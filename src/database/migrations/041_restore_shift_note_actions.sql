-- Migration 041: do zoznamu povolených akcií vrátiť poznámky k smenám
--
-- Migrácia 034 pridávala `discarded` a `discard_undone`. Obmedzenie
-- `chk_change_action` pritom zahodila a napísala nanovo - a zoznam opísala z
-- migrácie 026, ktorá je o jednu staršia než 027. Tým z neho vypadli
-- `shift_note_set` a `shift_note_cleared`, ktoré tam 027 pridala.
--
-- Odvtedy sa poznámka k smene nedala uložiť vôbec. Zápis do denníka zmien je
-- súčasťou tej istej transakcie ako samotná poznámka, takže ju obmedzenie
-- zhodilo celú a plánovač dostal na obrazovku hlášku z databázy.
--
-- Tu je zoznam úplný: všetko z 026, 027 aj 034. `day_flag_set` a
-- `day_flag_cleared` dnes nikto nezapisuje - príznaky dní sa do denníka
-- nelogujú - ale zostávajú povolené, lebo ich odobratie by nič nezískalo a
-- staré riadky by sa tým stali neplatnými.
--
-- Aby sa to nezopakovalo: `src/database/models/changeActions.js` drží ten istý
-- zoznam v kóde a `scripts/test-production-change-actions.js` skúša každú
-- hodnotu z neho zapísať do skutočnej databázy. Ďalšia migrácia, ktorá na
-- niektorú zabudne, spadne na teste a nie na plánovačovi.
--
-- Rollback: 041_restore_shift_note_actions_down.sql

ALTER TABLE production_change_log
    DROP CONSTRAINT IF EXISTS chk_change_action;

ALTER TABLE production_change_log
    ADD CONSTRAINT chk_change_action CHECK (action IN (
        'created', 'updated', 'moved', 'deleted', 'restored',
        'unscheduled', 'scheduled', 'day_flag_set', 'day_flag_cleared',
        'shift_note_set', 'shift_note_cleared',
        'discarded', 'discard_undone'
    ));
