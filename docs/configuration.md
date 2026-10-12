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

| Variable       | Required | Default       | Meaning                                                                                                                  |
| -------------- | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`     | no       | `development` | `development`, `test` or `production`. Jest sets `test`.                                                                 |
| `PORT`         | no       | `3000`        | HTTP port inside the process (1–65535).                                                                                  |
| `DATABASE_URL` | yes      |               | `postgres://` URL of the restricted runtime role `qaryati_app`. Never the owner role ([database.md](database.md#roles)). |

### Migrations

Read by `npm run db:*` (through `drizzle.config.ts`) and by the `migrate` service (`src/platform/database/migrate.ts`). Validated by `migrationEnvSchema` ([`src/config/migration-env.ts`](../src/config/migration-env.ts)).

| Variable             | Required | Meaning                                                                          |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `DATABASE_OWNER_URL` | yes      | `postgres://` URL of the owner role, the only role allowed to change the schema. |

The API never receives this variable. Its schema is separate, so the API cannot even read it by mistake.

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
