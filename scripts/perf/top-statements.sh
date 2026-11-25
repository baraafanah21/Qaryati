#!/usr/bin/env bash
# The 10 statements with the most total execution time, from pg_stat_statements
# (perf profile only: npm run perf:up). scripts/perf/run-k6.sh calls it after
# each run; `--reset` clears the statistics before one.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a
# shellcheck disable=SC1091
. ./.env
set +a
psql_owner() {
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
}

if [ "${1:-}" = "--reset" ]; then
  psql_owner -tAc 'SELECT pg_stat_statements_reset()'
  exit 0
fi

# Only the API's statements (role qaryati_app), not this query or migrations.
psql_owner -P pager=off -c "
SELECT round(s.total_exec_time::numeric, 1) AS total_ms,
       s.calls,
       round(s.mean_exec_time::numeric, 2) AS mean_ms,
       round(s.max_exec_time::numeric, 1) AS max_ms,
       s.rows,
       round(100.0 * s.shared_blks_hit / nullif(s.shared_blks_hit + s.shared_blks_read, 0), 1) AS hit_pct,
       left(regexp_replace(s.query, '\s+', ' ', 'g'), 300) AS query
FROM pg_stat_statements s
JOIN pg_roles r ON r.oid = s.userid
WHERE r.rolname = 'qaryati_app'
ORDER BY s.total_exec_time DESC
LIMIT 10;"
