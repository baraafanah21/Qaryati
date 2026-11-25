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

Two helpers record evidence next to the k6 numbers (both used for the [optimization report](#optimization-report-50-51-53)):

| Command                                         | Writes to `docs/performance/raw/` | What                                                                                                                                                                                |
| ----------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LABEL=<label> npm run perf:explain`            | `<label>-explain-search.txt`      | `EXPLAIN (ANALYZE, BUFFERS)` of the search statements (`perf/explain-search.sql`) for three terms, as `qaryati_app`, warm cache                                                     |
| `scripts/perf/sample-waits.sh <seconds> <file>` | the file given                    | during a run: every 0.5 s the state and wait event of each busy `qaryati_app` session (row-lock waits show as `Lock`), every 5 s `docker stats`; one `psql` session for all samples |

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

## Optimization report (#50, #51, #53)

One evidence-based change on the read path, an analysis of the write path, and the numbers before and after. The reference before any optimization is [performance/baseline.md](performance/baseline.md), which is kept unchanged as the historical record.

### Setup of this comparison

- **Same machine, stack, dataset, VUs and durations as the baseline** ([baseline.md](performance/baseline.md#machine-and-setup)): the same laptop, `npm run perf:up` (rate limiting off, `pg_stat_statements` on), k6 2.4.0 pinned by digest, 50 read VUs and 40 write VUs on 20 accounts, the default loads and the `THINK=0` saturation runs with `HOLD=1m`. `docker ps` was checked before each series: only the three Qaryati containers ran.
- **The "before" numbers were measured again on the same day, on clean data.** The database the baseline left behind had grown from 10 069 to 105 628 claims through the write runs, so a read run on it would not compare with anything. Each series therefore started from an empty volume (`docker compose down -v`), `npm run db:seed` and `npm run db:seed:perf` (815 villages, 10 069 claims, the same rows as the baseline), then ran the baseline's order: read default, read saturation, write default, write saturation. "Before" is the code of `main` at `5492b0c`; "after" is this branch. Re-measuring also removes the day-to-day drift of a laptop: today's "before" read saturation was 981 req/s against the baseline's 876 req/s, with the same code.
- Raw files: `before-*` and `after-*` in [`performance/raw/`](performance/raw/) (k6 summaries, top statements, wait samples, `EXPLAIN`).

### Bottleneck per scenario

| Scenario    | Slowest endpoint group by database time | Evidence                                                                                                                                                                                                                                                        |
| ----------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read-heavy  | `search` (`GET /villages?q=`)           | Its two statements were **98.2%** of the database time of the default run (page 51 302 ms, count 47 845 ms of 100 924 ms); every other statement is under 1%. At saturation the database container used about **680% CPU** (seven cores) and the API about 97%. |
| Write-heavy | `population_add` (60% of the requests)  | The largest statement cost is `insert into claim` (0.11 ms mean); all statements together take **0.18 ms per request** against an average latency of 29 ms at saturation. The time is spent outside the database (below).                                       |

### Read path (#50): the search ran its matching twice

**Root cause.** Each search sent two statements at once (`Promise.all`): the page, and `count(*)` with the same `WHERE`. The `WHERE` is the expensive part: a `UNION` of three trigram matches (Arabic name, English name, preferred alternative names joined to their claims). So every search did that matching twice and took **two pool connections** (the `pg` pool has 10).

**`EXPLAIN (ANALYZE, BUFFERS)`** (`before-explain-search.txt`, `q = بيت`, 110 matches; same shape for `kafr` and `الرما`):

| Statement                                         | Shared buffers | Execution time | Statements per request |
| ------------------------------------------------- | -------------- | -------------- | ---------------------- |
| A. page (before)                                  | 1 455          | 5.6 ms         | 1 of 2                 |
| B. `count(*)`, same `WHERE` (before)              | 454            | 4.0 ms         | 2 of 2                 |
| **C. page with `count(*) OVER ()` (after)**       | **1 449**      | **4.9 ms**     | **1**                  |
| D. ids once in a materialized CTE, page and count | 1 455          | 5.3–5.8 ms     | 1                      |

B repeats the whole matching subtree of A (the three trigram scans, the 1 630 preferred `VILLAGE_NAME` claims, the `UNION`). In C, a `WindowAgg` counts the matching rows before `LIMIT`; it adds almost nothing, because the page already computes every matching row to sort by relevance. D saves the same work but adds a materialization step and was slightly slower for all three terms. **C was chosen.**

**The change** (`village-search.sql.ts`, `DrizzleVillageRepository.search`): the page statement returns `count(*) OVER ()::int AS total` on each row, and the separate count is gone from a normal request. One case needs it: a page **after the last one** returns no row, so no row carries the total; then, and only when `page > 0`, the old `count(*)` runs, so `totalElements` stays correct. An empty first page means 0 matches, with no second statement. Integration tests (`test/village/village-search.int-spec.ts`, "paging") check the total on the first, a middle and a past-the-end page, on no match, and the number of statements sent to the pool (1, or 2 past the end).

### Results: read-heavy

**Default load (50 VUs, think time).** Throughput is set by the think time, and the p95 was already 12 ms, so the gain here is small, as expected:

| Group      | Requests (before → after) | Throughput          | Average            | p95                  | p99                  | Errors     |
| ---------- | ------------------------- | ------------------- | ------------------ | -------------------- | -------------------- | ---------- |
| search     | 11 447 → 11 485           | 71.4 → 71.7/s       | 7.83 → 7.81 ms     | 13.80 → 12.93 ms     | 19.16 → 15.14 ms     | 0 → 0%     |
| profile    | 6 941 → 6 816             | 43.3 → 42.5/s       | 4.29 → 4.29 ms     | 8.34 → 7.54 ms       | 11.97 → 9.82 ms      | 0 → 0%     |
| population | 4 394 → 4 547             | 27.4 → 28.4/s       | 3.29 → 3.35 ms     | 6.65 → 6.25 ms       | 9.32 → 8.05 ms       | 0 → 0%     |
| **All**    | **22 791 → 22 857**       | **142.1 → 142.7/s** | **5.88 → 5.87 ms** | **12.22 → 11.71 ms** | **17.04 → 14.20 ms** | **0 → 0%** |

The average search latency did not move: one 4 ms statement instead of two 4 ms statements **run in parallel** costs the same wall time when the database has idle cores. What changed at this load is the cost, not the latency: database time per search went from **8.66 ms to 4.49 ms**, and the read test's total database time from 100.9 s to 53.6 s.

**Saturation (`THINK=0`, 50 VUs, hold 1 min).** Here the database's cores were the shared resource, and halving the work shows:

| Group      | Requests (before → after) | Throughput                   | Average              | p95                         | p99                  | Errors     |
| ---------- | ------------------------- | ---------------------------- | -------------------- | --------------------------- | -------------------- | ---------- |
| search     | 49 357 → 63 944           | 493.5 → 639.3/s              | 25.31 → 20.18 ms     | 36.58 → 28.91 ms            | 40.06 → 32.68 ms     | 0 → 0%     |
| profile    | 29 387 → 38 433           | 293.8 → 384.2/s              | 56.52 → 42.25 ms     | 82.33 → 61.61 ms            | 87.46 → 68.12 ms     | 0 → 0%     |
| population | 19 376 → 25 715           | 193.7 → 257.1/s              | 55.29 → 41.43 ms     | 80.97 → 60.76 ms            | 86.50 → 67.16 ms     | 0 → 0%     |
| **All**    | **98 129 → 128 101**      | **981.1 → 1 280.7/s** (+31%) | **40.57 → 31.07 ms** | **78.53 → 58.40 ms** (−26%) | **85.00 → 65.03 ms** | **0 → 0%** |

| Database side at saturation                    | Before           | After                      |
| ---------------------------------------------- | ---------------- | -------------------------- |
| Search statements per request                  | 2 (page + count) | 1                          |
| Pool connections held per search               | 2                | 1                          |
| Separate `count(*)` calls                      | 49 357           | 0                          |
| Database time per search request               | 8.39 ms          | 4.20 ms                    |
| Search share of database time (top statements) | 98.9%            | 97.7%                      |
| Busy `qaryati_app` sessions (mean of samples)  | 5.9              | 4.3, for 31% more requests |
| `docker stats` CPU: database / API             | ~680% / ~97%     | ~505% / ~105–116%          |

Search is still almost all of the database time, because it is still the only statement that does real work; each search now does it once. Profile and population history gained the most latency although their SQL did not change: they wait for the single Node process, which had been sharing the laptop's cores with seven busy database cores. After the change the API process is at its one-core limit, so **the API process, not the database, is now the bottleneck of the read path**.

### Write path (#51): analysis, no change

| Group (default load) | Requests (before → after) | Throughput          | Average            | p95                  | p99                  | Errors     |
| -------------------- | ------------------------- | ------------------- | ------------------ | -------------------- | -------------------- | ---------- |
| population_add       | 10 418 → 10 403           | 68.8 → 68.8/s       | 8.38 → 8.68 ms     | 12.89 → 12.97 ms     | 14.99 → 14.92 ms     | 0 → 0%     |
| landmark_add         | 5 191 → 5 279             | 34.3 → 34.9/s       | 7.32 → 7.50 ms     | 11.25 → 11.10 ms     | 13.27 → 13.06 ms     | 0 → 0%     |
| village_read         | 1 763 → 1 722             | 11.6 → 11.4/s       | 2.35 → 2.39 ms     | 4.28 → 4.07 ms       | 5.18 → 4.74 ms       | 0 → 0%     |
| village_patch        | 1 763 → 1 722             | 11.6 → 11.4/s       | 6.38 → 6.68 ms     | 9.83 → 9.70 ms       | 11.63 → 11.47 ms     | 0 → 0%     |
| **All**              | **19 224 → 19 215**       | **127.0 → 127.0/s** | **7.37 → 7.63 ms** | **12.35 → 12.36 ms** | **14.74 → 14.67 ms** | **0 → 0%** |

| Group (saturation) | Requests (before → after) | Throughput              | Average              | p95                  | p99                  | Errors     |
| ------------------ | ------------------------- | ----------------------- | -------------------- | -------------------- | -------------------- | ---------- |
| population_add     | 55 888 → 56 663           | 613.9 → 622.5/s         | 30.50 → 30.09 ms     | 39.89 → 39.21 ms     | 46.16 → 45.63 ms     | 0 → 0%     |
| landmark_add       | 27 748 → 28 258           | 304.8 → 310.4/s         | 28.95 → 28.55 ms     | 38.19 → 37.57 ms     | 43.76 → 43.38 ms     | 0 → 0%     |
| village_read       | 9 481 → 9 462             | 104.1 → 103.9/s         | 21.73 → 21.55 ms     | 29.96 → 29.72 ms     | 33.60 → 34.69 ms     | 0 → 0%     |
| village_patch      | 9 481 → 9 462             | 104.1 → 103.9/s         | 28.80 → 28.61 ms     | 38.08 → 37.65 ms     | 42.98 → 44.01 ms     | 0 → 0%     |
| **All**            | **102 687 → 103 934**     | **1 128.0 → 1 141.7/s** | **29.10 → 28.75 ms** | **39.15 → 38.53 ms** | **44.68 → 44.34 ms** | **0 → 0%** |

`PATCH` with `If-Match`: default load **5 → 3** answers 412 (0.3% → 0.2%); saturation **674 → 669** answers 412 (7.1% → 7.1% of 9 481 / 9 462). The write numbers move within run-to-run noise (about ±3%), as they should: no write code changed.

Where a write's time goes (`before-saturation-write-heavy-*`):

- **Statements.** A population claim is about seven short statements in one transaction: the village and source existence checks, `insert into claim` (0.11 ms mean, the most expensive: the claim row and its indexes, including the partial unique index on the preferred claim of a group), the claim read back by id, the preferred population for the anomaly rule, `insert into population_record` (0.03 ms) and `insert into audit_entry` (0.03 ms). The ten top statements total 18.6 s of database time for 102 687 requests: **0.18 ms per request** against a 29 ms average latency.
- **Lock waits: none.** In 1 485 session samples at saturation, **0 waited on a heavyweight lock** (`wait_event_type = Lock`). Two VUs racing on one draft do not block each other: the optimistic `version` check rejects the loser with 412 instead of making it wait.
- **Transaction time is spent in the API process.** 69% of the samples are `idle in transaction`: a transaction is open and the database waits for the API's next statement. 22% are WAL writes and fsync at commit (`WALWrite`, `WALSync`), the cost of a durable commit per write; 7% are on CPU. At saturation the API container ran at ~112% CPU (its one JavaScript core) and the database at ~107%.

**No change, and why.** The evidence points at the single Node process, not at the SQL: there is no lock contention to remove, the statements are already sub-millisecond, and the 412s are the optimistic lock doing its job. The options the numbers suggest were rejected for this PR: `synchronous_commit = off` would remove the WAL fsync wait but could lose acknowledged writes on a crash, which an archive of claims with an audit trail must not do; merging the existence checks into the inserts would save two round trips of 0.01 ms each; more API processes is a deployment change, listed below.

### #45 (Redis cache of the profile): not justified

The profile's 17 statements take about **0.5 ms of database time together** (0.03 ms each in `pg_stat_statements`), and its latency comes from waiting for the Node process. A Redis cache-aside would replace 0.5 ms of SQL by a Redis round trip plus JSON parsing **in the same Node process**, and add eviction after every claim change. The measurements do not support it, so #45 is closed without code.

### What we would do next

1. **More than one API process** (Node cluster or several `api` replicas behind a load balancer): both paths are now bound by one JavaScript core. Measure with the same scripts.
2. **Search, once more:** a partial index on `claim (id) WHERE claim_type = 'VILLAGE_NAME' AND is_preferred` (the plan reads 377 buffers of `claim` per search), and a check that the trigram indexes are used as the tables grow (today the planner prefers sequential scans on 815 villages).
3. **Writes:** only if a later load shows the database as the limit, group commit settings (`commit_delay`) before anything that weakens durability.

### Limits of the measurement

- One laptop: k6, the API, PostgreSQL and Redis share 16 logical CPUs, so the saturation figures are lower bounds and the containers compete with each other (the read gain is partly the API getting back cores the database used).
- Docker on Linux, one run per configuration; run-to-run noise is about ±3% (compare the unchanged write numbers), and a laptop drifts between days (today's "before" against the baseline).
- Synthetic data (815 villages, ten thousand claims); with far more names the trigram plans may change.
- The sampler adds one `psql` session and `docker stats` calls during every "before" and "after" run alike, which the baseline did not have.
- Not done from #53: the Grafana screenshots, because the dashboard of #49 was cut (see [Observability](#observability-during-a-run-49-reduced)); the k6 summaries and the sample files are the record.
