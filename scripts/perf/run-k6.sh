#!/usr/bin/env bash
# Runs one k6 scenario of perf/ in the pinned grafana/k6 image, on the Compose
# network, against the api service (docs/performance.md).
#
#   scripts/perf/run-k6.sh <read-heavy|write-heavy|rate-limit-check> [extra k6 args]
#
# Writes to docs/performance/raw/:
#   <label>-<scenario>.json                the k6 end-of-test summary
#   <label>-<scenario>-top-statements.txt  top 10 statements by total time
# LABEL defaults to "latest"; the baseline was written with LABEL=baseline.
# Statement statistics are reset before the run, so the dump covers this run only.
# The k6 exit code is kept: a missed threshold fails the command.
set -uo pipefail
cd "$(dirname "$0")/../.."

# Pinned by digest: the same k6 for every run (docs/tech-stack.md).
K6_IMAGE="grafana/k6:2.4.0@sha256:d41bb79cd8de5a7ad619b53570e3712633e8bff0937010a5c6c57a4747e7a276"
scenario="${1:?usage: run-k6.sh <scenario> [k6 args]}"
shift
label="${LABEL:-latest}"
out="docs/performance/raw"
mkdir -p "$out"

network="$(docker compose ps -q api | xargs -r docker inspect \
  --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' | head -n1)"
if [ -z "$network" ]; then
  echo "The api container is not running: npm run perf:up (or docker compose up -d) first." >&2
  exit 1
fi

statements=false
if [ "$scenario" != "rate-limit-check" ] && scripts/perf/top-statements.sh --reset >/dev/null 2>&1; then
  statements=true
fi

docker run --rm --network "$network" --user "$(id -u):$(id -g)" \
  -v "$PWD/perf:/perf:ro" -v "$PWD/$out:/out" \
  -e BASE_URL=http://api:3000 -e VUS -e HOLD -e RAMP -e USERS -e MAX_REQUESTS -e THINK \
  "$K6_IMAGE" run --summary-export "/out/$label-$scenario.json" "$@" "/perf/$scenario.js"
status=$?

if [ "$statements" = true ]; then
  scripts/perf/top-statements.sh >"$out/$label-$scenario-top-statements.txt"
  echo "Top statements: $out/$label-$scenario-top-statements.txt"
fi
exit $status
