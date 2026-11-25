# Performance testing

How Qaryati is load-tested with [k6](https://grafana.com/docs/k6/), what each scenario does, and how to repeat a measurement. The numbers themselves are in [performance/baseline.md](performance/baseline.md) (before any optimization) and, later, in the reports that compare against it.

## Rules for every measurement

- **Honest:** a run that misses a threshold fails (k6 exits non-zero) and is reported as it is. Thresholds are targets, not filters; no request is dropped from the statistics.
- **Reproducible:** the dataset is deterministic (`npm run db:seed:perf`, fixed random seed), k6 is pinned by digest, the scripts are in `perf/`, and every run writes its raw k6 summary and its top statements to `docs/performance/raw/`.
- **Comparable:** a later report runs the same commands on the same machine and dataset and puts its numbers next to the baseline.

## Rate limiting is off during the load tests

The API limits anonymous callers to **120 requests per minute per IP** (#25). k6 runs in one container, so **every virtual user has the same IP**: with the limit on, a read test would get 120 answers per minute and 429 for everything else, and would measure the limiter, not the API.

So the perf profile sets `RATE_LIMIT_ENABLED=false` **in `docker-compose.perf.yml` only**. `.env.example` and `docker-compose.yml` keep it `true`, so a normal `docker compose up` always has rate limiting on.

The limiter is still checked, by a separate short script, `npm run perf:ratelimit` (`perf/rate-limit-check.js`), on the **normal** stack: one client sends requests until it gets a 429 and checks that it carries a positive integer `Retry-After` and the `RATE_LIMITED` problem body. In the baseline run, the 121st request got the 429 ([baseline.md](performance/baseline.md#rate-limiting-check)).

What this means for the numbers: with the limiter on, each request also does one Redis round trip (an `INCR` with expiry). The measured latencies leave out that cost. It is small next to a database query, but it is not zero.

## The perf profile

`docker-compose.perf.yml` is an override, used only by `npm run perf:up`:

| Service | Change                                                                                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`    | `shared_preload_libraries=pg_stat_statements` (`track=all`), and `log_min_duration_statement=100`: every statement slower than 100 ms goes to `docker compose logs db`. |
| `api`   | `RATE_LIMIT_ENABLED=false` (above).                                                                                                                                     |

`npm run perf:up` (`scripts/perf/up.sh`) starts the stack with the override, runs `CREATE EXTENSION IF NOT EXISTS pg_stat_statements` as the owner role, and prints the active settings, so you can see that statement statistics are on before the first measurement. To go back to the normal stack: `docker compose up -d` (it recreates `db` and `api` without the override; the data volume stays).

## Running a measurement

```bash
cp .env.example .env && npm run keys:dev     # once
npm run perf:up                              # stack + pg_stat_statements, rate limiting off
npm run db:seed && npm run db:seed:perf      # 15 sample + 800 synthetic villages (idempotent)
LABEL=baseline npm run perf:read             # read-heavy scenario
LABEL=baseline npm run perf:write            # write-heavy scenario
docker compose up -d                         # back to the normal stack (rate limiting on)
LABEL=baseline npm run perf:ratelimit        # the 429 + Retry-After check
```

Each `perf:*` command runs `scripts/perf/run-k6.sh`: the pinned `grafana/k6` image on the Compose network against `http://api:3000`, so the host's ports and the k6 container's own network stack are the same for everyone. It resets `pg_stat_statements` before the run and writes:

| File in `docs/performance/raw/`         | Content                                                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `<label>-<scenario>.json`               | k6 end-of-test summary: every metric, per endpoint group, with avg, p90, p95, p99 and rate; `setup_data` (the test accounts' tokens) is removed |
| `<label>-<scenario>-top-statements.txt` | the 10 statements of `qaryati_app` with the most total execution time during this run                                                           |

`LABEL` defaults to `latest`. Environment variables tune a run without editing the scripts: `VUS`, `RAMP`, `HOLD` (stage lengths such as `30s`, `2m`), `USERS` (write-heavy accounts), and `THINK=0`, which removes the think time to find the throughput limit (the "saturation" runs). `npm run perf:statements` prints the current top statements; `npm run perf:inspect` checks that all three scripts parse (CI runs it).

## Scenarios

### Read-heavy (`perf/read-heavy.js`, #47)

Anonymous visitors, like the public site.

| Share | Request                                  | Tag (`endpoint`) |
| ----- | ---------------------------------------- | ---------------- |
| 50%   | `GET /villages?q=<partial name>&size=20` | `search`         |
| 30%   | `GET /villages/{slug}/profile`           | `profile`        |
| 20%   | `GET /villages/{id}/population?size=50`  | `population`     |

- `setup()` reads every published village (pages of 100) and fails at once on an empty database.
- The search term is 3–6 letters of one word of a real village name, Arabic or English (`بيت`, `Kafr`, `الرما`, ...): partial names, as people type them.
- Load: ramp to 50 VUs in 30 s, hold 2 min, ramp down in 10 s. Think time 0.1–0.5 s between requests.
- Thresholds: `http_req_failed < 1%` and `p(95) < 500 ms`, overall and per endpoint group; checks (status 200) > 99%.

### Write-heavy (`perf/write-heavy.js`, #48)

Logged-in contributors.

| Share | Request                                                               | Tag (`endpoint`)                |
| ----- | --------------------------------------------------------------------- | ------------------------------- |
| 60%   | `POST /villages/{id}/population` (random year, count type and number) | `population_add`                |
| 30%   | `POST /villages/{id}/landmarks` (unique name)                         | `landmark_add`                  |
| 10%   | `GET /villages/{draft}` for the `ETag`, then `PATCH` with `If-Match`  | `village_read`, `village_patch` |

- `setup()` registers and logs in `USERS` (default 20) accounts **through the API**, and each creates its own source (population claims require one) and its own draft village (a creator may `PATCH` their draft). Registration hashes passwords with Argon2, so setup takes some seconds; it is not part of the measured load.
- Each account is shared by two VUs (40 VUs, 20 accounts), so two VUs really race on the same draft: the loser's `If-Match` is stale.
- **412 is counted separately and is not an error.** `http.setResponseCallback` marks 2xx and 412 as expected, so `http_req_failed` counts only real failures; the custom counters `precondition_failed_412` and `patch_applied_200` split the `PATCH` answers.
- Load: ramp to 40 VUs in 20 s, hold 2 min, ramp down in 10 s; same think time. Thresholds: failures < 1%, `p(95) < 800 ms` (writes run a transaction, a claim, a fact row and an audit entry).
- Each run adds data (about 15 000 unverified claims at the default load). Measure reads before writes, or reseed on a fresh volume, when comparing runs.

### Rate-limit check (`perf/rate-limit-check.js`)

See [above](#rate-limiting-is-off-during-the-load-tests). One VU, one iteration: `GET /villages?size=1` until the first 429 (at most 200 requests), then checks `Retry-After` and the problem body. Thresholds: at least one 429, every check passed.

## Observability during a run (#49, reduced)

- **Top statements:** `pg_stat_statements`, reset before each run, dumped after it (see the table above). Only statements of `qaryati_app` are listed, so the dump shows the API, not migrations or the dump query itself.
- **Slow-query log:** `log_min_duration_statement=100`; `docker compose logs db | grep duration:` lists every statement over 100 ms.
- **Containers:** `docker stats` during a run shows whether the API process or the database is the busy one ([baseline.md](performance/baseline.md#where-the-time-goes)).
- **Not done here:** the Grafana dashboard and screenshots of #49 (latency per route, pool, event-loop lag) were cut from this task. The API already exposes Prometheus metrics on the internal `METRICS_PORT` (#43) for a later dashboard.
