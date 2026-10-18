#!/bin/sh
set -eu
# psql quoting keeps generated credentials out of SQL syntax and process arguments.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password NOVA_DB_PASSWORD
CREATE ROLE nova_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DATABASE nova OWNER TO nova_app;
SQL
