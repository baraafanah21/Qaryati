# Configuration

All configuration comes from environment variables. There is no hidden configuration: every variable is listed in [`.env.example`](../.env.example) and on this page.

## Where variables come from

| Situation                                      | Source                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run start:dev`, `npm run db:*` (the host) | `.env` in the repository root, copied from `.env.example`. A variable already set in the shell wins over `.env`.            |
| `docker compose up`                            | Compose reads `.env` for the `${...}` values in `docker-compose.yml` and passes each container only the variables it needs. |
| Tests                                          | Testcontainers starts its own database, and the tests set `DATABASE_URL` themselves. `.env` is not needed to run the tests. |

`.env` is in `.gitignore` and must never be committed.

## Variables

### API

Read by the API process and validated at startup by `appEnvSchema` ([`src/config/app-env.ts`](../src/config/app-env.ts)).

| Variable                        | Required | Default                          | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | -------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                      | no       | `development`                    | `development`, `test` or `production`. Jest sets `test`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `PORT`                          | no       | `3000`                           | HTTP port inside the process (1–65535).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `LOG_LEVEL`                     | no       | `info`                           | Minimum log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. The e2e tests default to `silent`. Compose passes it to the `api` container. Logs are JSON except when `NODE_ENV=development` ([kernel.md](kernel.md#logging)).                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `DATABASE_URL`                  | yes      |                                  | `postgres://` URL of the restricted runtime role `qaryati_app`. Never the owner role ([database.md](database.md#roles)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ADMIN_UNITS_CACHE_TTL_SECONDS` | no       | `3600`                           | Seconds each API process keeps administrative units in its in-process cache (integer ≥ 1). Reference data that changes almost never; a changed unit is visible after at most this long ([village README](../src/modules/village/README.md#administrative-units)). Compose passes it to the `api` container.                                                                                                                                                                                                                                                                                                                                                               |
| `PRODUCTS_CACHE_TTL_SECONDS`    | no       | `3600`                           | Seconds each API process keeps products in its in-process cache (integer ≥ 1). Reference data that changes only by migration; a changed product is visible after at most this long ([economy README](../src/modules/economy/README.md#products)). Compose passes it to the `api` container.                                                                                                                                                                                                                                                                                                                                                                               |
| `SWAGGER_ENABLED`               | no       | on, except `NODE_ENV=production` | `true`/`false` (also `1`/`0`, `yes`/`no`). Serves Swagger UI at `/api/docs` and the document at `/api/docs-json`. Unset (or empty) means on in development and test and **off in production**, where it would publish the whole API surface. An explicit value always wins over `NODE_ENV`: `true` turns Swagger on even with `NODE_ENV=production`, `false` turns it off in development. `.env.example` sets `true` for local development only; never set it in a production environment. Compose does not pass it to the `api` container, so the image stays off. `npm run openapi:generate` does not need it ([kernel.md](kernel.md#documenting-an-endpoint-swagger)). |

### Security and operations

Read by the platform modules in `src/platform/redis`, `rate-limit`, `metrics` and `http` (#25, #42, #43) and validated at startup with the other API variables. Compose passes all of them to the `api` container.

| Variable                          | Required | Default                  | Meaning                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | -------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REDIS_URL`                       | no       | `redis://localhost:6379` | `redis://` or `rediss://` URL of the Redis holding the rate-limit counters. Compose sets `redis://redis:6379`. The API starts and serves requests without Redis: rate limiting then fails open and `/health/ready` answers 503.                                                                                                                             |
| `RATE_LIMIT_ENABLED`              | no       | `true`                   | `false` turns every rate limit off. The test suites set it (they share one Redis and one client IP); `test/security.e2e-spec.ts` turns it back on. Never `false` in production.                                                                                                                                                                             |
| `RATE_LIMIT_ANONYMOUS_PER_MINUTE` | no       | `120`                    | Requests per minute per client IP without a verified token (integer ≥ 1).                                                                                                                                                                                                                                                                                   |
| `RATE_LIMIT_USER_PER_MINUTE`      | no       | `300`                    | Requests per minute per user with a verified token (integer ≥ 1).                                                                                                                                                                                                                                                                                           |
| `RATE_LIMIT_LOGIN_PER_MINUTE`     | no       | `5`                      | Login attempts per minute per client IP and email (integer ≥ 1). Counted on top of the anonymous limit.                                                                                                                                                                                                                                                     |
| `CORS_ORIGINS`                    | no       | empty                    | Comma-separated browser origins allowed by CORS, each a bare `scheme://host[:port]` (no path, no trailing slash), for example `http://localhost:5173,https://qaryati.example`. Empty means no other origin may read responses in a browser. `.env.example` lists the web client's dev origin.                                                               |
| `TRUST_PROXY`                     | no       | `false`                  | Express `trust proxy`, which decides the client IP (`req.ip`) the anonymous and login limits count by. `false`: the socket address. A number: that many reverse-proxy hops (`1` behind one proxy). Otherwise trusted addresses or subnets (`loopback, 10.0.0.0/8`). `true` is refused: every client could then choose its own IP through `X-Forwarded-For`. |
| `METRICS_PORT`                    | no       | `9464`                   | Port of the internal Prometheus endpoint `GET /metrics` (0–65535; `0` picks a free port, used by the tests). Compose does **not** publish it: only containers on the Compose network can scrape it.                                                                                                                                                         |

The body limit (1 MB), the lockout (10 failures, 15 minutes) and the statement timeout (5 s) are not configurable: they are fixed in code or in a migration, and tested.

### Geocoding

Read by the geo module ([geo README](../src/modules/geo/README.md)) and validated at startup with the other API variables. Compose passes all of them to the `api` container. What each policy value does and why: [geo README](../src/modules/geo/README.md#resilience-and-cache-37).

| Variable                      | Required                      | Default                               | Meaning                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEO_PROVIDER`                | no                            | `stub`                                | `stub` (fixed fixtures, no network: development, tests, CI, k6) or `nominatim` (the public OpenStreetMap geocoder).                                                                                             |
| `GEO_NOMINATIM_URL`           | no                            | `https://nominatim.openstreetmap.org` | Base URL of the Nominatim API, without `/search`; an `http(s)` URL. Point it at a self-hosted instance to avoid the public rate limit.                                                                          |
| `GEO_USER_AGENT`              | with `GEO_PROVIDER=nominatim` |                                       | `User-Agent` sent to Nominatim, required by its usage policy. A project identifier such as `Qaryati/1.0 (university project)`. **Never a personal email address**: the schema rejects any value containing `@`. |
| `GEO_TIMEOUT_MS`              | no                            | `5000`                                | Time limit of one geocoding attempt in milliseconds (100–60000). A slower answer counts as a timeout.                                                                                                           |
| `GEO_RETRY_BASE_MS`           | no                            | `200`                                 | First retry delay in milliseconds; doubles per retry, with jitter. Integer 1–10000.                                                                                                                             |
| `GEO_BREAKER_THRESHOLD`       | no                            | `5`                                   | Consecutive failed geocoding calls that open the circuit breaker. Integer 1–100.                                                                                                                                |
| `GEO_BREAKER_HALF_OPEN_MS`    | no                            | `30000`                               | How long the breaker stays open before one trial call, in milliseconds. Integer 100–3600000.                                                                                                                    |
| `GEO_MIN_INTERVAL_MS`         | no                            | `1000`                                | Least time between two Nominatim requests, in milliseconds (its policy: 1 per second). Integer 0–60000.                                                                                                         |
| `GEO_QUEUE_TIMEOUT_MS`        | no                            | `5000`                                | Longest a caller waits for its turn at the Nominatim rate limiter, in milliseconds. Integer 0–60000.                                                                                                            |
| `GEO_CACHE_TTL_SECONDS`       | no                            | `2592000`                             | Seconds a non-empty geocoding result stays in Redis (default 30 days). Integer 1–31536000.                                                                                                                      |
| `GEO_CACHE_EMPTY_TTL_SECONDS` | no                            | `86400`                               | Seconds an empty geocoding result stays in Redis (default 24 hours). Integer 1–31536000.                                                                                                                        |

### JWT secret files

The API also validates these settings at startup:

| Variable               | Required | Default   | Meaning                                                                                                                                                                                                                       |
| ---------------------- | -------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_PRIVATE_KEY_FILE` | yes      |           | Path to a PKCS#8 PEM RSA private key.                                                                                                                                                                                         |
| `JWT_PUBLIC_KEY_FILE`  | yes      |           | Path to the matching SPKI PEM RSA public key.                                                                                                                                                                                 |
| `JWT_ISSUER`           | no       | `qaryati` | Expected `iss` claim of access tokens.                                                                                                                                                                                        |
| `JWT_ACCESS_TTL`       | no       | `15m`     | Runtime access-token lifetime; positive integer followed by `s`, `m` or `h`, for example `45s`, `15m`, `2h`. Validated at startup into safe integer seconds; login `expiresIn` uses that value (default 900).                 |
| `JWT_REFRESH_TTL`      | no       | `7d`      | Refresh-token lifetime; positive integer followed by `s`, `m`, `h` or `d`, for example `12h`, `7d`. Every refresh token (from login or from a rotation) expires this long after it is issued. Invalid values prevent startup. |

Key material is configured through file paths only. JWT_ACCESS_TTL and JWT_REFRESH_TTL are passed to the API by Compose (defaults 15m and 7d); invalid, zero, fractional, unitless or overflowing durations prevent startup. IAM reads and parses the files once at startup and rejects missing, malformed, mismatched, non-RSA or shorter-than-2048-bit keys. It never logs key material. There are no fallback or embedded keys. Generate local files as shown in [development.md](development.md#jwt-keys).

On the host, `.env.example` points at the ignored `secrets/` directory. Compose reads those host paths and mounts them as `jwt_private_key` and `jwt_public_key` under `/run/secrets/`; only the API service receives them. The files must be readable by the container's `node` user (UID 1000 on Linux). The image never contains the keys. Migrations need no JWT configuration. The OpenAPI generator uses path placeholders because preview mode never instantiates the key provider.

Tests generate temporary files and clean them up. Database-only integration suites use path placeholders because they do not load IAM. The IAM integration suite uses real keys and, since #14, migrated PostGIS to exercise the module persistence wiring. JWT_ACCESS_TTL controls production issuance; it does not change the explicit lifetime overrides of the test token helper.

### Migrations

Read by `npm run db:*` (through `drizzle.config.ts`) and by the `migrate` service (`src/platform/database/migrate.ts`). Validated by `migrationEnvSchema` ([`src/config/migration-env.ts`](../src/config/migration-env.ts)).

| Variable             | Required | Meaning                                                                          |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `DATABASE_OWNER_URL` | yes      | `postgres://` URL of the owner role, the only role allowed to change the schema. |

The API never receives this variable. Its schema is separate, so the API cannot even read it by mistake.

### Seeds

Read by `npm run db:seed` and `npm run db:seed:perf` and validated by `seedEnvSchema` ([`src/config/seed-env.ts`](../src/config/seed-env.ts)). Both tools refuse to run when `NODE_ENV=production` ([seeds README](../src/seed/README.md)).

| Variable             | Required | Default                 | Meaning                                                                                                        |
| -------------------- | -------- | ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`           | no       | `development`           | `production` stops both seeds before they connect.                                                             |
| `DATABASE_OWNER_URL` | yes      |                         | The owner role (as for migrations): `db:seed` promotes its first administrator, `db:seed:perf` bulk-loads.     |
| `SEED_API_URL`       | no       | `http://localhost:3000` | `http(s)` base URL of the running API that `db:seed` calls (without `/api/v1`).                                |
| `PERF_SEED_VILLAGES` | no       | `800`                   | Number of synthetic villages `db:seed:perf` writes (1–20 000). The same number always gives the same villages. |

The load tests set no variable of their own in `.env`: the perf profile turns rate limiting off in `docker-compose.perf.yml` only ([performance.md](performance.md#rate-limiting-is-off-during-the-load-tests)), and k6 reads `VUS`, `RAMP`, `HOLD`, `USERS`, `THINK` and `LABEL` from the shell of the `npm run perf:*` command.

### Docker Compose

Used only by `docker-compose.yml` and the database container. The Node process never reads them.

| Variable            | Default (`.env.example`) | Meaning                                                                                        |
| ------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`     | `qaryati_owner`          | Owner role, created by the postgres image on first start. Runs migrations.                     |
| `POSTGRES_PASSWORD` | `owner-dev-password`     | Password of the owner role.                                                                    |
| `POSTGRES_DB`       | `qaryati`                | Database name.                                                                                 |
| `APP_DB_PASSWORD`   | `app-dev-password`       | Password of `qaryati_app`, read by `docker/postgres/init/20-create-app-role.sh`.               |
| `DB_HOST_PORT`      | `5432`                   | Host port for the database (bound to `127.0.0.1`). Change it if 5432 is taken on your machine. |
| `REDIS_HOST_PORT`   | `6379`                   | Host port for Redis.                                                                           |
| `API_HOST_PORT`     | `3000`                   | Host port for the API container.                                                               |

Compose builds the containers' URLs itself from these values, for example `DATABASE_URL=postgres://qaryati_app:${APP_DB_PASSWORD}@db:5432/${POSTGRES_DB}`. The `DATABASE_URL` and `DATABASE_OWNER_URL` lines in `.env` are for processes on the host, so they use `localhost:${DB_HOST_PORT}`. If you change a password, a database name or `DB_HOST_PORT`, change the matching URL in `.env` too.

Passwords appear inside URLs, so keep them to letters, digits, `-` and `_`. Other characters would need percent-encoding.

The database container reads `POSTGRES_*` and `APP_DB_PASSWORD` **only when its data volume is empty**. After changing them, recreate the volume with `docker compose down -v` (this deletes local data).

## Validation

`@nestjs/config` 12 accepts any [Standard Schema](https://standardschema.dev/), so `createAppConfigModule()` passes the zod schema directly as `validationSchema`. No custom `validate` function is needed. On invalid input the app does not start, and Nest prints one line per problem:

```text
ERROR [ExceptionHandler] Error: Config validation error: PORT: must be a number
DATABASE_URL: must be a postgres:// connection URL
```

`src/config/app-config.module.spec.ts` pins this format, so a library upgrade that changes it fails a test.

The migration tools run outside Nest. `loadMigrationEnv()` loads `.env` with Node's built-in `process.loadEnvFile()`, validates with `migrationEnvSchema` and throws the same message format.

## Reading configuration in code

Inject `ConfigService` typed with the schema, and read with `infer: true`:

```ts
constructor(private readonly config: ConfigService<AppEnv, true>) {}

const port = this.config.get('PORT', { infer: true }); // number
```

Rules:

- **Only `src/config` reads `process.env`** (CONTEXT.md). Everything else gets configuration through `ConfigService`.
- **Adding a variable** means changing, in the same PR: the zod schema, `.env.example`, this page and, if a container needs it, `docker-compose.yml`.
