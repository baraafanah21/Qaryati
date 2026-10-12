# Development

How to set up the project, what every script does, and how to run each kind of test.

## Prerequisites

| Tool    | Version                | Why                                                                                           |
| ------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| Node.js | 24 LTS (see `.nvmrc`)  | The runtime of the API, the tooling and the tests. `package.json` `engines` allows only 24.x. |
| npm     | comes with Node 24     | Installs exact versions from `package-lock.json`.                                             |
| Git     | any recent             | Husky hooks run on commit.                                                                    |
| Docker  | any recent, Compose v2 | Runs the database, Redis and the API (`docker compose`), and the Testcontainers tests.        |

With [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install    # reads .nvmrc
nvm use
```

## Setup

```bash
git clone git@github.com:baraafanah21/Qaryati.git
cd Qaryati
nvm use
npm ci                  # exact versions from package-lock.json; also installs the Git hooks (prepare → husky)
cp .env.example .env    # local configuration, see configuration.md
docker compose up -d --build --wait
curl localhost:3000/api/v1/health   # {"status":"ok"}
```

That runs everything in containers. To work on the API with hot reload, stop the API container and run it on the host against the same database:

```bash
docker compose stop api
npm run start:dev       # reads .env, connects to the Compose database as qaryati_app
```

`npm ci` runs the `prepare` script, which points Git at `.husky/` for hooks. If the hooks do not run on commit, run `npx husky` once.

## Running with Docker

`docker compose up -d --build --wait` starts four services and returns once they are healthy:

| Service   | Image                                 | What it does                                                                                                              | Host port (`.env`)       |
| --------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `db`      | `postgis/postgis:16-3.5`              | PostgreSQL 16 with PostGIS. On first start it creates the owner role and runs the init script that creates `qaryati_app`. | `DB_HOST_PORT` (5432)    |
| `redis`   | `redis:7.4-alpine`                    | Cache and, later, rate limits and queues. Nothing uses it yet.                                                            | `REDIS_HOST_PORT` (6379) |
| `migrate` | `qaryati-api:local` (this repository) | One-shot: applies pending migrations as the owner role, then exits with code 0.                                           | none                     |
| `api`     | `qaryati-api:local`                   | The API, connected as `qaryati_app`. Starts only after `migrate` has succeeded.                                           | `API_HOST_PORT` (3000)   |

Ports are bound to `127.0.0.1` only. If a port is taken, for example by a local PostgreSQL on 5432, change it in `.env` and update the matching URL ([configuration.md](configuration.md#docker-compose)).

```bash
docker compose ps -a                     # db, redis, api healthy; migrate "Exited (0)"
docker compose logs api | grep Database  # Connected to PostgreSQL as qaryati_app
docker compose up -d --build --wait      # after pulling: rebuilds the image and applies new migrations
docker compose down                      # stop; data stays in the db-data volume
docker compose down -v                   # stop and delete the database (needed after changing POSTGRES_* or APP_DB_PASSWORD)
docker compose exec db psql -U qaryati_owner -d qaryati   # SQL shell as the owner
```

The `Dockerfile` builds in two stages. The first compiles TypeScript with dev dependencies. The second contains only production dependencies, `dist/` and `migrations/`, and runs as the unprivileged `node` user. `.dockerignore` lets in only the files the build needs, so `.env` and Git history never reach the image.

## npm scripts

| Script         | What it does                                                                                                     | When to use it                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `start:dev`    | Starts the API with `nest start --watch`; restarts on file changes                                               | Daily development                 |
| `start:debug`  | Same, with the Node inspector open                                                                               | Debugging in the editor           |
| `start`        | Compiles and starts once                                                                                         | Quick manual check                |
| `build`        | Compiles `src/` to `dist/` with `tsconfig.build.json` (tests excluded)                                           | Before `start:prod`; in Docker    |
| `start:prod`   | Runs `dist/main.js` with source maps enabled                                                                     | Production-like run after `build` |
| `typecheck`    | `tsc --noEmit` over `src/`, `test/` and root config files                                                        | Before pushing; in CI             |
| `lint`         | ESLint with type-aware rules over the repository                                                                 | Before pushing; in CI             |
| `lint:fix`     | ESLint with automatic fixes                                                                                      | After a lint failure              |
| `format`       | Prettier writes every supported file                                                                             | After a format failure            |
| `format:check` | Prettier checks every supported file, changes nothing                                                            | Before pushing; in CI             |
| `depcruise`    | dependency-cruiser checks module and layer boundaries in `src/` ([architecture.md](architecture.md#enforcement)) | Before pushing; in CI             |
| `test:unit`    | Jest project `unit`: `src/**/*.spec.ts`                                                                          | Constantly                        |
| `test:int`     | Jest project `integration`: `test/**/*.int-spec.ts`, real PostGIS via Testcontainers                             | Before pushing                    |
| `test:e2e`     | Jest project `e2e`: `test/**/*.e2e-spec.ts`, the app over HTTP                                                   | Before pushing                    |
| `test:cov`     | Unit tests with a coverage report in `coverage/`                                                                 | To find untested code             |
| `db:generate`  | drizzle-kit writes a SQL migration from the modules' `schema.ts` files ([database.md](database.md#migrations))   | After changing a `schema.ts`      |
| `db:migrate`   | Applies pending migrations as the owner role (`DATABASE_OWNER_URL`)                                              | After pulling or generating       |
| `db:check`     | Checks the migration history for conflicts                                                                       | After a rebase                    |
| `db:studio`    | Drizzle Studio, a browser UI for the local database                                                              | Looking at data                   |
| `prepare`      | Installs the Husky Git hooks; npm runs it automatically after install                                            | Never by hand                     |

Before every push, run the same checks as CI:

```bash
npm run format:check && npm run lint && npm run typecheck && npm run depcruise && npm run test:unit && npm run test:int && npm run test:e2e
```

## Tests

| Type        | Location and name                         | What it may use                                                                                                                             | Speed        |
| ----------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Unit        | Next to the code: `src/**/<name>.spec.ts` | Plain objects only. No Nest testing module, no database, no network.                                                                        | Milliseconds |
| Integration | `test/**/<name>.int-spec.ts`              | Real PostGIS in Docker via Testcontainers, one container per file. Never mocks the database.                                                | Seconds      |
| End-to-end  | `test/**/<name>.e2e-spec.ts`              | The full Nest app, configured with `configureApp()` exactly like `main.ts`, called over HTTP with Supertest. One PostGIS container per run. | Seconds      |

Notes:

- Integration and e2e tests need Docker running. How the test database is built and shared: [database.md](database.md#testing-against-the-database).
- Tests run under `node --experimental-vm-modules`. NestJS 12 is published as ES modules, while this project compiles to CommonJS; the flag lets Jest load those packages. This is what the official Nest 12 project template does. The flag prints an `ExperimentalWarning` line, which is expected.
- Coverage counts real code only. Nest module classes (`*.module.ts`), `index.ts` files and `main.ts` are wiring and are excluded.

## Git hooks

| Hook         | Runs          | Effect                                                                                                                                                                    |
| ------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` | `lint-staged` | Staged `.ts/.js/.cjs/.mjs` files: `eslint --fix` then `prettier --write`. Staged `.json/.md/.yml`: `prettier --write`. The commit stops if ESLint still reports an error. |
| `commit-msg` | `commitlint`  | The message must be a Conventional Commit with an allowed scope (see [workflow.md](workflow.md#commits)).                                                                 |

The hooks give fast feedback; CI repeats every check (#4), so skipping a hook only delays the failure.

## Project layout

```
src/
  main.ts                 starts the app on PORT
  app.module.ts           composition root: imports every module
  config/                 environment schemas (zod); the only code that reads process.env
  platform/
    http/configure-app.ts global prefix /api, URI versioning (default v1), shutdown hooks
    database/             DatabaseModule (typed Drizzle instance), migrate.ts (migration runner)
    health/               GET /api/v1/health → { "status": "ok" }; replaced by Terminus in #43
  shared/                 kernel, arrives in #9
  modules/<module>/       9 business modules, see architecture.md
    index.ts              public API
    <module>.module.ts    Nest module
    web/ application/ domain/ infrastructure/
    infrastructure/persistence/schema.ts   the module's tables (all but profile)
    README.md             responsibility, data, API, dependencies
test/                     integration and e2e tests; support/ starts the test database
migrations/               SQL migrations generated by drizzle-kit
docker/postgres/init/     database init script (creates qaryati_app)
Dockerfile                API image, also used by the migrate service
docker-compose.yml        db, redis, migrate, api
drizzle.config.ts         drizzle-kit configuration
```

## TypeScript settings

`tsconfig.json` uses `strict` plus the flags below. Each one turns a class of runtime bugs into compile errors:

| Flag                               | What it catches                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `strict`                           | `null`/`undefined` misuse, implicit `any`, unsafe `this`, uninitialised class fields, unchecked `catch` variables            |
| `noUncheckedIndexedAccess`         | `rows[0]` and `map[key]` are typed as possibly `undefined`, so a missing row is handled, not assumed                         |
| `noImplicitOverride`               | A method that overrides a base method must say `override`, so renaming the base method cannot silently leave a dead override |
| `noImplicitReturns`                | Every path of a function with a return type returns a value                                                                  |
| `noFallthroughCasesInSwitch`       | A `case` cannot fall into the next one by accident                                                                           |
| `forceConsistentCasingInFileNames` | `import './Village'` vs `./village` fails on Linux CI. This flag catches it on case-insensitive laptops too.                 |

`emitDecoratorMetadata` and `experimentalDecorators` are required by NestJS dependency injection.
