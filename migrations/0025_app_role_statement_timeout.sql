-- Custom migration (#42): every statement of the runtime role qaryati_app is
-- cancelled after 5 seconds. A runaway query (a missing index, a huge page)
-- then fails with SQLSTATE 57014, which the API answers as 503
-- SERVICE_UNAVAILABLE, instead of holding a pooled connection and its locks.
-- The owner role (migrations) keeps no limit, so long migrations still run.
-- Applies to new sessions only; the API's pool reconnects after a deploy.
-- docs/database.md, "Roles".
ALTER ROLE qaryati_app SET statement_timeout = '5s';
