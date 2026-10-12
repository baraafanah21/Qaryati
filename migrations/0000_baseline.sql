-- Baseline: the extensions every later migration may rely on.
-- postgis: geography(Point,4326) columns, distance queries, GiST indexes.
-- pg_trgm: typo-tolerant search over Arabic and English names (GIN trigram indexes).
-- citext: case-insensitive text for unique user emails.
-- IF NOT EXISTS because the postgis/postgis image already creates postgis in
-- POSTGRES_DB on first start; on other servers this migration creates it.
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
