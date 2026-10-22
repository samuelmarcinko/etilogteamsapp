-- Rollback 041: späť na zoznam z migrácie 034.
--
-- Pozor: tým sa poznámky k smenám znovu rozbijú - presne to je chyba, ktorú
-- migrácia 041 opravuje. Je tu preto, aby sa dalo vrátiť, nie preto, že by to
-- bol stav, v ktorom má niečo bežať.
--
-- Riadky s `shift_note_set` alebo `shift_note_cleared`, ktoré medzitým
-- vznikli, by nové obmedzenie neprešli, tak sa najprv odstránia. Denník zmien
-- je inak len na čítanie, takže je to jediné miesto, kde sa z neho maže.

DELETE FROM production_change_log
 WHERE action IN ('shift_note_set', 'shift_note_cleared');

ALTER TABLE production_change_log
    DROP CONSTRAINT IF EXISTS chk_change_action;

ALTER TABLE production_change_log
    ADD CONSTRAINT chk_change_action CHECK (action IN (
        'created', 'updated', 'moved', 'deleted', 'restored',
        'unscheduled', 'scheduled', 'day_flag_set', 'day_flag_cleared',
        'discarded', 'discard_undone'
    ));
