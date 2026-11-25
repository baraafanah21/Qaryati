#!/usr/bin/env bash
# npm run perf:up: the Compose stack with the perf override (docs/performance.md),
# then pg_stat_statements created and checked, so the first measurement already
# records statements.
set -euo pipefail
cd "$(dirname "$0")/../.."

docker compose -f docker-compose.yml -f docker-compose.perf.yml up -d --build --wait

# The owner role from .env (Compose reads the same file).
set -a
# shellcheck disable=SC1091
. ./.env
set +a
psql_owner() {
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA "$@"
}

psql_owner -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
preload=$(psql_owner -c 'SHOW shared_preload_libraries')
slow=$(psql_owner -c 'SHOW log_min_duration_statement')
psql_owner -c 'SELECT count(*) FROM pg_stat_statements' >/dev/null
echo "pg_stat_statements: on (shared_preload_libraries=$preload); slow-query log: $slow"

limit=$(docker compose -f docker-compose.yml -f docker-compose.perf.yml exec -T api printenv RATE_LIMIT_ENABLED)
echo "API rate limiting: RATE_LIMIT_ENABLED=$limit"
