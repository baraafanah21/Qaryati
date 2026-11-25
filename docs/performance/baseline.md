# Performance baseline (before any optimization)

Measured on 2026-11-25 with the method of [docs/performance.md](../performance.md), on the code of `main` at `483792a` (this branch adds seeds, k6 scripts and the perf profile, and no change to the API). **Nothing was optimized for these numbers**; they are the reference for task 13. Raw files: [`raw/`](raw/).

## Machine and setup

| Item        | Value                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| CPU         | Intel Core i7-12650H, 16 logical CPUs (laptop)                                                                                            |
| Memory      | 15 GB (Docker sees 15.2 GB)                                                                                                               |
| OS          | Linux 7.0 (kernel 7.0.0-43), Docker Engine 29.6.1, Compose v2                                                                             |
| Stack       | `npm run perf:up`: one API container (Node 24.22.3, one process, `NODE_ENV=production`), PostgreSQL 16.9 + PostGIS 3.5, Redis 7.4         |
| Load        | k6 2.4.0 (`grafana/k6` pinned by digest) in a container on the Compose network, same machine                                              |
| Differences | rate limiting off (see [why](../performance.md#rate-limiting-is-off-during-the-load-tests)); `pg_stat_statements` on; `GEO_PROVIDER=stub` |

k6 and the stack share the laptop's CPUs, so the saturation numbers are a lower bound of what the API does on its own machine.

## Dataset

`npm run db:seed` then `npm run db:seed:perf` (800 synthetic villages, fixed random seed), on a database that already had the 15 sample villages. Rows when the read runs started (printed by `db:seed:perf`):

| Table                 | Rows   |
| --------------------- | ------ |
| `village`             | 815    |
| `claim`               | 10 069 |
| `village_name`        | 1 630  |
| `village_location`    | 815    |
| `village_affiliation` | 815    |
| `population_record`   | 3 127  |
| `landmark`            | 2 428  |
| `village_product`     | 1 235  |
| `name_origin`         | 15     |
| `facility`            | 4      |
| `source`              | 5      |
| `user_account`        | 5      |
| `audit_entry`         | 359    |

Every claim of the dataset is verified and preferred, so every profile, search hit and population history the read test asks for is a full one. The write runs came after the reads and added data (each write run registers 20 accounts and submits about 15 000 claims at default load); after all runs the database held 105 628 claims and 240 MB.

## Results

Throughput is requests per second **over the whole run, ramps included** (`http_reqs` rate). Latencies are server round trips seen by k6 on the Compose network. Error rate is `http_req_failed`.

### Read-heavy, default load (50 VUs, think time 0.1–0.5 s, 2 min 40 s)

`raw/baseline-read-heavy.json`. All thresholds passed.

| Endpoint group                             | Requests   | Throughput      | Average     | p95          | p99          | Errors    |
| ------------------------------------------ | ---------- | --------------- | ----------- | ------------ | ------------ | --------- |
| `search` (`GET /villages?q=`)              | 11 302     | 70.5 req/s      | 7.42 ms     | 13.78 ms     | 20.76 ms     | 0.00%     |
| `profile` (`/villages/{slug}/profile`)     | 6 896      | 43.0 req/s      | 3.55 ms     | 6.81 ms      | 11.02 ms     | 0.00%     |
| `population` (`/villages/{id}/population`) | 4 600      | 28.7 req/s      | 2.66 ms     | 5.10 ms      | 8.46 ms      | 0.00%     |
| **All**                                    | **22 807** | **142.3 req/s** | **5.29 ms** | **11.26 ms** | **18.13 ms** | **0.00%** |

At this load the throughput is set by the think time of 50 users (about 3 requests per second each), not by the server.

### Read-heavy, saturation (`THINK=0`, 50 VUs, hold 1 min)

`raw/baseline-saturation-read-heavy.json`: no think time, to find how much the single API process serves.

| Endpoint group | Requests   | Throughput      | Average      | p95          | p99           | Errors    |
| -------------- | ---------- | --------------- | ------------ | ------------ | ------------- | --------- |
| `search`       | 43 938     | 439.2 req/s     | 28.10 ms     | 42.57 ms     | 48.29 ms      | 0.00%     |
| `profile`      | 26 261     | 262.5 req/s     | 63.40 ms     | 97.16 ms     | 108.04 ms     | 0.00%     |
| `population`   | 17 441     | 174.3 req/s     | 61.96 ms     | 95.90 ms     | 106.49 ms     | 0.00%     |
| **All**        | **87 649** | **876.1 req/s** | **45.41 ms** | **91.61 ms** | **102.63 ms** | **0.00%** |

### Write-heavy, default load (40 VUs on 20 accounts, think time 0.1–0.5 s, 2 min 30 s)

`raw/baseline-write-heavy.json`. All thresholds passed.

| Endpoint group                         | Requests   | Throughput      | Average     | p95         | p99          | Errors    |
| -------------------------------------- | ---------- | --------------- | ----------- | ----------- | ------------ | --------- |
| `population_add` (`POST /population`)  | 10 422     | 68.8 req/s      | 5.79 ms     | 9.30 ms     | 13.30 ms     | 0.00%     |
| `landmark_add` (`POST /landmarks`)     | 5 492      | 36.3 req/s      | 5.15 ms     | 8.20 ms     | 11.93 ms     | 0.00%     |
| `village_read` (`GET /villages/{id}`)  | 1 748      | 11.5 req/s      | 1.60 ms     | 2.82 ms     | 4.55 ms      | 0.00%     |
| `village_patch` (`PATCH` + `If-Match`) | 1 748      | 11.5 req/s      | 4.58 ms     | 7.39 ms     | 10.06 ms     | 0.00%     |
| **All**                                | **19 499** | **128.8 req/s** | **5.16 ms** | **8.68 ms** | **13.11 ms** | **0.00%** |

`PATCH` answers: **1 747 applied (200), 1 stale (412)**. With think time, two VUs rarely read the same version at the same moment.

### Write-heavy, saturation (`THINK=0`, 40 VUs, hold 1 min)

`raw/baseline-saturation-write-heavy.json`.

| Endpoint group   | Requests   | Throughput        | Average      | p95          | p99          | Errors    |
| ---------------- | ---------- | ----------------- | ------------ | ------------ | ------------ | --------- |
| `population_add` | 53 265     | 584.9 req/s       | 32.02 ms     | 42.87 ms     | 50.62 ms     | 0.00%     |
| `landmark_add`   | 26 380     | 289.7 req/s       | 30.50 ms     | 40.99 ms     | 49.19 ms     | 0.00%     |
| `village_read`   | 8 871      | 97.4 req/s        | 23.05 ms     | 32.33 ms     | 38.36 ms     | 0.00%     |
| `village_patch`  | 8 871      | 97.4 req/s        | 30.56 ms     | 41.10 ms     | 49.41 ms     | 0.00%     |
| **All**          | **97 476** | **1 070.3 req/s** | **30.64 ms** | **42.05 ms** | **49.61 ms** | **0.00%** |

`PATCH` answers: **8 234 applied (200), 637 stale (412, 7.2%)**: the optimistic lock rejects every lost race, and none of them is counted as an error.

### Rate-limiting check

`raw/baseline-rate-limit-check.json`, on the normal stack (rate limiting on, 120 per minute anonymous): requests 1–120 answered 200, **request 121 answered 429 with `Retry-After` and the `RATE_LIMITED` problem body**. Both checks passed.

## Top statements

Full dumps: `raw/baseline-*-top-statements.txt` (10 statements each, `qaryati_app` only, statistics reset before each run).

**Read-heavy, default load** (total execution time during the run):

| #   | Statement                                            | Calls  | Total     | Mean    | Share of DB time |
| --- | ---------------------------------------------------- | ------ | --------- | ------- | ---------------- |
| 1   | village search, page (`similarity`, trigram `UNION`) | 11 302 | 49 813 ms | 4.41 ms | 51%              |
| 2   | village search, `count(*)` with the same `WHERE`     | 11 302 | 45 524 ms | 4.03 ms | 47%              |
| 3   | profile: preferred landmarks                         | 6 896  | 261 ms    | 0.04 ms | < 1%             |
| 4   | profile: preferred claims with their sources         | 6 896  | 259 ms    | 0.04 ms | < 1%             |
| 5   | profile: latest population (`DISTINCT ON`)           | 6 896  | 218 ms    | 0.03 ms | < 1%             |

**Write-heavy, default load:**

| #   | Statement                                          | Calls  | Total    | Mean    |
| --- | -------------------------------------------------- | ------ | -------- | ------- |
| 1   | `insert into claim`                                | 15 914 | 2 386 ms | 0.15 ms |
| 2   | `insert into audit_entry`                          | 17 741 | 663 ms   | 0.04 ms |
| 3   | `insert into population_record`                    | 10 422 | 412 ms   | 0.04 ms |
| 4   | preferred population of the village (anomaly rule) | 10 422 | 313 ms   | 0.03 ms |
| 5   | `INSERT INTO landmark`                             | 5 492  | 268 ms   | 0.05 ms |

**Slow-query log:** no statement took 100 ms or more in any run (`docker compose logs db | grep duration:` is empty). The slowest single statement was a search page query at 23.1 ms.

## Where the time goes

Facts from the runs above, for task 13 to start from. No change is made in this PR.

- **Search is the database's work.** Its two statements are 98% of the database time of the read test. Each search runs the trigram query twice: once for the page and once for `count(*)` with the same `WHERE`, about 4 ms each. At saturation the search statements used 392 s of database time in about 100 s, so roughly four database cores were busy with search alone.
- **Profile and population history are the API process's work.** The profile's 17 statements take about 0.5 ms together, yet its p95 grows from 6.8 ms to 97 ms at saturation while search, which waits on the database, stays at 43 ms. The single Node process (one CPU core for JavaScript) is the limit for these two.
- **Writes are cheap per statement.** At saturation (1 070 req/s), `docker stats` showed the API container at 111% CPU and the database at 162%: the claim insert and its indexes are the largest database cost, and the audit entry is the second.
- **No errors and no timeouts** in any run, including at saturation; the 5 s `statement_timeout` (#42) was never reached.

Candidates to measure in task 13: the double search query (`count(*)`), a cache of the profile document (#45, only if it pays off), and more than one API process.
