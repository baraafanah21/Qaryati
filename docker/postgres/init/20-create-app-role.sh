#!/usr/bin/env bash
# Creates the restricted runtime role qaryati_app.
#
# The postgres image runs this once, when the data volume is empty. The owner
# role (POSTGRES_USER) owns the database and runs the migrations; qaryati_app
# may only read and write rows in tables the owner creates. It cannot create,
# alter or drop anything. Integration tests run this same file
# (test/support/test-database.ts). See docs/database.md.
set -euo pipefail

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

psql --no-psqlrc -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$APP_DB_PASSWORD" \
  --set=owner="$POSTGRES_USER" \
  --set=db="$POSTGRES_DB" <<'SQL'
CREATE ROLE qaryati_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Only the owner and qaryati_app may connect; nobody else may create schemas,
-- temporary tables or objects in public.
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO qaryati_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO qaryati_app;

-- Every table and sequence the owner creates later (that is, every migration)
-- is usable by qaryati_app for DML only. TRUNCATE, REFERENCES and TRIGGER are
-- not granted.
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qaryati_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO qaryati_app;
SQL
