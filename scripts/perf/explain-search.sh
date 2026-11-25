#!/usr/bin/env bash
# EXPLAIN (ANALYZE, BUFFERS) of the search statements (perf/explain-search.sql)
# for a few search terms like the ones of the read test, as the runtime role.
#
#   LABEL=before npm run perf:explain
#
# Writes docs/performance/raw/<label>-explain-search.txt. Each statement is
# run once to warm the cache, then explained, so the plans show warm buffers
# like the load test does.
set -euo pipefail
cd "$(dirname "$0")/../.."

label="${LABEL:-latest}"
out="docs/performance/raw/$label-explain-search.txt"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

run() {
  docker compose exec -T -e PGPASSWORD="$APP_DB_PASSWORD" db \
    psql -v ON_ERROR_STOP=1 -h localhost -U qaryati_app -d "$POSTGRES_DB" -v q="$1" -f - \
    <perf/explain-search.sql
}

{
  echo "# EXPLAIN (ANALYZE, BUFFERS) of GET /villages?q=<term>&size=20 ($(date -u +%FT%TZ))"
  # An Arabic prefix with many hits, an English prefix, and a rare term.
  for term in 'بيت' 'kafr' 'الرما'; do
    run "$term" >/dev/null
    echo
    echo "################ q = $term ################"
    run "$term"
  done
} >"$out"
echo "EXPLAIN output: $out"
