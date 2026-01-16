-- Clear all test tickets from database
DELETE FROM tickets;

-- Reset auto-increment sequence
ALTER SEQUENCE tickets_id_seq RESTART WITH 1;

-- Show result
SELECT COUNT(*) as remaining_tickets FROM tickets;
