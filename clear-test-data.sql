-- =====================================================
-- CLEAR TEST DATA SCRIPT
-- Pre prechod na ostru prevadzku
-- =====================================================
-- POZOR: Tento skript zmaze vsetky testovacie data!
-- Pred spustenim si urobte zalohu databazy!
-- =====================================================

-- Zmazanie vsetkych tiketov (ticket_actions a ticket_attachments sa zmazu automaticky cez CASCADE)
DELETE FROM tickets;

-- Zmazanie PN-iek
DELETE FROM sick_notes;

-- Reset kvot zamestnancov (pouzite dni dovolenky/PN)
DELETE FROM employee_quotas;

-- Reset sekvencii pre auto-increment ID
ALTER SEQUENCE tickets_id_seq RESTART WITH 1;
ALTER SEQUENCE sick_notes_id_seq RESTART WITH 1;
ALTER SEQUENCE employee_quotas_id_seq RESTART WITH 1;
ALTER SEQUENCE ticket_actions_id_seq RESTART WITH 1;
ALTER SEQUENCE ticket_attachments_attachment_id_seq RESTART WITH 1;

-- Overenie - zobrazenie poctu zaznamov v kazdom tabulke
SELECT 'tickets' as tabulka, COUNT(*) as pocet FROM tickets
UNION ALL
SELECT 'ticket_actions', COUNT(*) FROM ticket_actions
UNION ALL
SELECT 'ticket_attachments', COUNT(*) FROM ticket_attachments
UNION ALL
SELECT 'sick_notes', COUNT(*) FROM sick_notes
UNION ALL
SELECT 'employee_quotas', COUNT(*) FROM employee_quotas
UNION ALL
SELECT 'holidays', COUNT(*) FROM holidays
UNION ALL
SELECT 'users', COUNT(*) FROM users;

-- Hotovo!
SELECT 'Testovacie data boli uspesne zmazane!' as stav;
