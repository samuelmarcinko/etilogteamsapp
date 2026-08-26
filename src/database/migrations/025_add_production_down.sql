-- Rollback for 025_add_production.sql
--
-- Not executed by the runner (*_down.sql is ignored); apply by hand:
--   docker compose -f docker-compose.infomaniak.yml exec -T teams-app-db \
--     sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < src/database/migrations/025_add_production_down.sql
--   ... -c "DELETE FROM schema_migrations WHERE version = 25"
--
-- DESTRUCTIVE once the planner holds real data: this drops the production plan
-- itself. Take a backup first. Nothing outside the production module depends on
-- these tables, so no other module is affected.

DROP TABLE IF EXISTS production_calendar_exceptions;
DROP TABLE IF EXISTS production_day_flags;
DROP TABLE IF EXISTS production_plan_entries;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS production_shifts;
DROP TABLE IF EXISTS production_locations;

-- update_updated_at_column() is left in place - it comes from schema.sql and is
-- used by the tickets, users and roles triggers.
