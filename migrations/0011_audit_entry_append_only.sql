-- The audit trail is append-only for the API. The default privileges from
-- docker/postgres/init/20-create-app-role.sh grant qaryati_app full DML on every
-- new table; take back everything except INSERT and SELECT (TRUNCATE is never
-- granted by default and is revoked here explicitly so the intent is visible).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_entry" FROM qaryati_app;
