-- Rollback for 024_add_roles_permissions.sql
--
-- Not executed by the runner (*_down.sql files are ignored); apply by hand:
--   docker compose -f docker-compose.infomaniak.yml exec -T teams-app-db \
--     sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < src/database/migrations/024_add_roles_permissions_down.sql
--   docker compose ... exec teams-app-db sh -c \
--     'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM schema_migrations WHERE version = 24"'
--
-- Safe at any time while the resolver is not enforcing: nothing outside these
-- two tables depends on them, and users.role was never modified.

DROP TRIGGER IF EXISTS update_roles_updated_at ON roles;

DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS roles;

-- update_updated_at_column() is left in place: it comes from schema.sql and is
-- used by the tickets and users triggers.
