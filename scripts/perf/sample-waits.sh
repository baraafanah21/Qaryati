#!/usr/bin/env bash
# Samples what the API's database sessions are doing, and the containers' CPU,
# while a k6 run is going (docs/performance.md, "Observability during a run").
#
#   scripts/perf/sample-waits.sh <seconds> <output file>
#
# Every 0.5 s: one row per qaryati_app session that is not idle, with its
# state and wait event (Lock/transactionid is a row-lock wait, LWLock/... an
# internal one, empty means on CPU). Every 5 s: `docker stats` of the stack.
# At the end, a summary: share of samples per wait event, and the number of
# samples with a session waiting on a lock.
set -euo pipefail
cd "$(dirname "$0")/../.."

seconds="${1:?usage: sample-waits.sh <seconds> <output file>}"
out="${2:?usage: sample-waits.sh <seconds> <output file>}"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

samples="$(mktemp)"
stats="$(mktemp)"
trap 'rm -f "$samples" "$stats"' EXIT

# One psql session for all the samples (\watch), so sampling costs one idle
# connection and not one process per sample.
count=$((seconds * 2))
printf '%s\n' "SELECT state, coalesce(wait_event_type, 'CPU'), coalesce(wait_event, 'CPU')
  FROM pg_stat_activity WHERE usename = 'qaryati_app' AND state <> 'idle'
\\watch i=0.5 c=$count" |
  docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F '|' -P footer=off \
    2>/dev/null | grep '|' >"$samples" &
sampler=$!

end=$((SECONDS + seconds))
while [ "$SECONDS" -lt "$end" ]; do
  docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' >>"$stats" 2>/dev/null || true
  sleep 5
done
wait "$sampler" || true

{
  echo "# Session samples of qaryati_app (non-idle sessions, every 0.5 s, ${seconds} s)"
  echo "# count | state | wait_event_type | wait_event"
  sort "$samples" | uniq -c | sort -rn
  echo
  echo "# Samples waiting on a heavyweight lock (wait_event_type = Lock): $(grep -c '|Lock|' "$samples" || true)"
  echo "# Session samples in total: $(wc -l <"$samples")"
  echo
  echo "# docker stats every 5 s: name cpu mem"
  cat "$stats"
} >"$out"
echo "Wait samples: $out"
