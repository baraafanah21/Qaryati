# Technology stack

One entry per technology, library or tool. Each entry gives the version, its role in Qaryati, the reason we chose it (tied to a quality attribute), the alternatives we rejected and the cost we accepted.

**Status** is **In use** once the issue that adds it is merged, and **Planned (#n)** before that. Exact versions are pinned when the dependency is installed (`save-exact=true` in `.npmrc`), and the entry is updated in the same PR.

**Rule:** a PR that adds a dependency or tool adds or updates its entry here.

## Overview

| Area                       | Technology                                                                                           | Status                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Collaboration              | GitHub, GitHub Projects, branch protection + CODEOWNERS, GitHub CLI + jq                             | In use                             |
| Runtime and language       | Node.js 24 LTS, TypeScript 6 (strict)                                                                | In use (#2)                        |
| Framework and architecture | NestJS 12 (+ reflect-metadata, rxjs, @nestjs/cli), hexagonal modules                                 | In use (#2)                        |
| Code quality               | ESLint, typescript-eslint, Prettier, Husky, lint-staged, commitlint, dependency-cruiser              | In use (#2)                        |
| Testing                    | Jest, ts-jest, Supertest, @nestjs/testing                                                            | In use (#2)                        |
| Testing (database)         | Testcontainers                                                                                       | In use (#3)                        |
| Data                       | PostgreSQL 16, PostGIS, pg_trgm, citext, Drizzle ORM, drizzle-kit, node-postgres, two database roles | In use (#3)                        |
| Cache and queues           | Redis 7                                                                                              | Running (#3), first used in #9/#25 |
| Configuration              | zod, @nestjs/config                                                                                  | In use (#3)                        |
| Containers                 | Docker Compose, node:24-slim, postgis/postgis:16-3.5, redis:7.4-alpine                               | In use (#3)                        |
| CI and supply chain        | GitHub Actions, gitleaks, Dependabot                                                                 | In use (#4)                        |

---

## Collaboration

### GitHub

- **Version:** github.com (hosted)
- **Status:** In use (#1)
- **Role:** hosts the repository, issues, pull requests, reviews and CI (from #4).
- **Why:** code, plan, reviews and checks live in one place, so every contribution is traceable (Git process is 15% of the grade). _Maintainability, traceability._
- **Alternatives:** GitLab: equivalent features, but the team already uses GitHub, and GitHub Actions and Projects are free here.
- **Cost:** private repositories on a free personal plan cannot use branch protection. The repository must be public, or the owner needs GitHub Pro (free with the Student Developer Pack).

### GitHub Projects

- **Version:** Projects (v2)
- **Status:** In use (#1)
- **Role:** the board "Qaryati" with Backlog, Ready, In progress, In review, Done; it holds every planned issue.
- **Why:** shows at a glance who works on what and what is blocked, next to the issues themselves. _Development speed, transparency._
- **Alternatives:** Trello or Jira: a second tool to keep in sync with the issues by hand.
- **Cost:** someone must move cards; automation covers only "closed/merged → Done".

### Branch protection + CODEOWNERS

- **Version:** GitHub feature; configuration in `scripts/github-bootstrap.sh` and `.github/CODEOWNERS`
- **Status:** In use (#1)
- **Role:** enforces issue → PR → review → merge on `main`. Details in [workflow.md](workflow.md#branch-protection-on-main).
- **Why:** the process holds even when someone is in a hurry, and every member's contribution is traceable. _Security, maintainability._
- **Alternatives:** trusting conventions: one direct push breaks traceability and nothing warns.
- **Cost:** the owner's own PRs need a second approver (Hamam), and admins cannot bypass the rules in an emergency.

### GitHub CLI (gh) + jq

- **Version:** gh 2.98.0, jq 1.7 (on the machine that runs the script)
- **Status:** In use (#1)
- **Role:** `scripts/github-bootstrap.sh` uses them to configure the repository: settings, labels, milestones, issues, project and protection.
- **Why:** the configuration is code. It can be reviewed in a PR, run again safely and audited later. _Maintainability, reproducibility._
- **Alternatives:** clicking through the GitHub UI: not repeatable, with no record of what was set. Terraform's GitHub provider: a whole extra tool for a one-time setup.
- **Cost:** a Bash script to maintain. Project workflows ("Item closed → Done") cannot be set through the API and are checked by hand.

---

## Runtime and language

### Node.js 24 LTS

- **Version:** 24 (`.nvmrc`), `engines: >=24 <25`; developed on 24.21.0
- **Status:** In use (#2). The Dockerfile (`node:24-slim`, #3) and CI (`node-version-file: .nvmrc`, #4) use the same major version.
- **Role:** runs the API, migrations, tooling and tests.
- **Why:** an LTS line has long security support, and one runtime for the whole team avoids version differences. _Security, maintainability._
- **Alternatives:** odd-numbered "current" releases: short support windows.
- **Cost:** none significant.

### TypeScript (strict)

- **Version:** 6.0.3
- **Status:** In use (#2). Every strict flag and what it catches: [development.md](development.md#typescript-settings).
- **Role:** the language of all code.
- **Why:** types act as contracts between 5 developers and 9 modules, and errors surface at compile time instead of in production. _Maintainability, correctness._
- **Why 6 and not 7:** TypeScript 7.0 (the native Go compiler) is the npm `latest`, but typescript-eslint 8 supports only `<6.1` and ts-jest only `<7`, because 7.0 does not offer the compiler API they use. 6.0 is also what the official NestJS 12 template uses. We move to 7 when both tools support it.
- **Alternatives:** plain JavaScript: errors only at runtime.
- **Cost:** slightly more typing up front. Strict class fields mean DTOs declare fields with `!`.

---

## Framework and architecture

### NestJS

- **Version:** @nestjs/common, @nestjs/core, @nestjs/platform-express, @nestjs/testing 12.1.2; @nestjs/cli 12.0.8; @nestjs/schematics 12.0.6
- **Status:** In use (#2), Express adapter
- **Role:** HTTP layer, dependency injection, module system, guards and pipes. The CLI builds (`nest build`) and runs the dev server (`nest start --watch`). The schematics let `nest generate` scaffold files.
- **Why:** its module system maps 1:1 to our modular monolith. Dependency injection makes ports, adapters and test doubles natural. Guards and pipes centralise authentication and validation. _Modularity, testability._
- **Alternatives:** Express alone: each member would invent their own structure. Fastify alone: the same problem.
- **Cost:** more framework concepts and decorators to learn. NestJS 12 ships as ES modules while we compile to CommonJS, so Jest runs with `--experimental-vm-modules` (see Jest below).

#### Why NestJS 12 and not 11

- **Every Nest library we plan to use supports 12.** Checked on 2026-10-11 with `npm view <pkg> peerDependencies` on each package's latest version (table below). Staying on 11 would gain no compatibility and would start the project on the previous major version, with an upgrade waiting before the deadline.
- **It matches the toolchain.** The official Nest 12 template uses TypeScript 6 and Jest 30, the versions typescript-eslint and ts-jest support (see TypeScript above).

| Package                                       | Latest version | Peer range for `@nestjs/common`                                                                                   | Supports 12 | Used from |
| --------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------- | ----------- | --------- |
| nestjs-cls                                    | 7.0.1          | `>= 10 < 13`                                                                                                      | yes         | #9        |
| @nestjs-cls/transactional                     | 4.0.1          | `>= 10 < 13`                                                                                                      | yes         | #9        |
| @nestjs-cls/transactional-adapter-drizzle-orm | 2.0.1          | none (needs nestjs-cls ^7, transactional ^4, drizzle-orm `^0 \|\| >=1.0.0-rc.1 <2`; drizzle-orm latest is 0.45.4) | yes         | #9        |
| nestjs-pino                                   | 5.3.1          | `^11.0.8 \|\| ^12.0.2`                                                                                            | yes         | #9        |
| @nestjs/swagger                               | 12.0.2         | `^12.0.0` (also TypeScript `^5.5 \|\| ^6`)                                                                        | yes         | #9        |
| @nestjs/throttler                             | 6.7.1          | `^7 … \|\| ^12.0.0`                                                                                               | yes         | #25       |
| @nestjs/terminus                              | 12.1.0         | `^11.0.0 \|\| ^12.0.0`                                                                                            | yes         | #43       |
| @nestjs/jwt                                   | 12.0.2         | `^8 … \|\| ^12.0.0`                                                                                               | yes         | #10       |
| @nestjs/passport                              | 12.0.0         | `^11.0.0 \|\| ^12.0.0`                                                                                            | yes         | #10       |
| @nestjs/config                                | 12.0.1         | `^11.0.0 \|\| ^12.0.0`                                                                                            | yes         | #3        |
| @nestjs/bullmq                                | 12.0.0         | `^10 … \|\| ^12.0.0`                                                                                              | yes         | #41       |

Two constraints follow from the table. `@nestjs/swagger` 12 accepts TypeScript up to 6.x, another reason not to move to TypeScript 7 yet. `nestjs-pino` needs `@nestjs/common` ≥ 12.0.2, and we use 12.1.2.

#### CommonJS on an ESM-only framework

- NestJS 12 packages are ES modules only: `@nestjs/core` exports `./index.js` with no CommonJS build.
- Our code compiles to CommonJS, so `dist/main.js` contains `require("@nestjs/core")`. Node 24 loads ES modules through `require()` natively (`require(esm)`, stable since Node 22.12, `process.features.require_module === true`). No flag is needed at runtime. Verified in #2: `node dist/main` starts and serves `/api/v1/health`.
- The official Nest 12 project template still ships this CommonJS + Jest variant next to an ESM + Vitest variant, so CommonJS is a supported setup.
- The only place that needs a flag is Jest. Its module loader does not use Node's `require(esm)`, so tests run under `node --experimental-vm-modules`, as in the official template.

**Why we did not convert to ESM:** ESM would mean `"type": "module"`, `.js` extensions on every relative import, and in practice Vitest instead of Jest, because Jest's ESM mode is experimental too. That replaces the agreed test runner and adds friction for every member (a missing `.js` extension is a runtime error), with nothing gained at runtime. CommonJS keeps imports simple and works with every library in the table. If Jest drops the need for the flag, or the team moves to Vitest, converting later is a mechanical change.

### reflect-metadata + rxjs

- **Version:** reflect-metadata 0.2.2, rxjs 7.8.2
- **Status:** In use (#2)
- **Role:** required peer dependencies of NestJS. reflect-metadata stores the constructor parameter types that dependency injection reads, and rxjs powers interceptors and streams.
- **Why:** NestJS does not run without them. _Not a free choice._
- **Alternatives:** none.
- **Cost:** none.

### Hexagonal modules (web / application / domain / infrastructure)

- **Status:** In use (#2): 9 module skeletons, see [architecture.md](architecture.md)
- **Role:** the internal structure of every business module.
- **Why:** business rules stay framework-free and run in milliseconds in unit tests. Infrastructure can change without touching the rules. The brief explicitly asks for this. _Modularity, testability._
- **Alternatives:** a classic app layered by technical role: boundaries erode, and any service touches any table.
- **Cost:** more files and interfaces per feature.

---

## Code quality

### dependency-cruiser

- **Version:** 18.6.0
- **Status:** In use (#2), configuration in `.dependency-cruiser.cjs`
- **Role:** checks import rules: no cycles, framework-free domain, layer direction, cross-module access only through `index.ts`, the allowed module directions, and an independent shared kernel. Rules and how to read a violation: [architecture.md](architecture.md#enforcement).
- **Why:** turns module and layer boundaries into failing CI checks instead of review comments. _Modularity, maintainability._
- **Alternatives:** code review only: violations slip through. ESLint `import/no-restricted-paths`: it can express layer rules, but not cycles across the graph or one rule table generated per module.
- **Cost:** the rules must be maintained as the structure evolves. The direction table exists twice (config and docs) and must be kept identical.

### ESLint + typescript-eslint

- **Version:** eslint 10.12.0, @eslint/js 10.0.1, typescript-eslint 8.71.1, globals 17.13.0
- **Status:** In use (#2), flat config in `eslint.config.mjs`
- **Role:** static analysis. We use `recommended-type-checked`, which includes `no-floating-promises` and `no-misused-promises`, plus `consistent-type-imports`. `globals` declares Node and Jest globals.
- **Why:** catches bugs the compiler misses, above all un-awaited promises: a forgotten `await` on a database write silently loses the error. _Correctness._
- **Alternatives:** manual review. oxlint (used by the NestJS 12 template): much faster, but our stack and course materials use ESLint, and typescript-eslint's type-aware rules are the reference implementation.
- **Cost:** type-aware linting is slower than syntax-only linting (seconds, not milliseconds). Occasional rule friction.
- **Checked:** `consistent-type-imports` does not break NestJS dependency injection. typescript-eslint reads `emitDecoratorMetadata` from `tsconfig.json` and keeps constructor-injected classes as value imports (verified in #2 with a probe service).

### Prettier + eslint-config-prettier

- **Version:** prettier 3.9.10, eslint-config-prettier 10.1.8
- **Status:** In use (#2), `.prettierrc.json` (single quotes, trailing commas, width 100)
- **Role:** formats TypeScript, JSON, Markdown and YAML. eslint-config-prettier turns off ESLint rules that would fight Prettier.
- **Why:** removes formatting debates and noise from reviews; diffs show only real changes. _Development speed, maintainability._
- **Alternatives:** ESLint stylistic rules: slower, and they leave more choices open.
- **Cost:** occasional rule friction; Markdown tables get re-aligned.

### Husky + lint-staged + commitlint

- **Version:** husky 9.1.7, lint-staged 17.6.0, @commitlint/cli and @commitlint/config-conventional 21.2.3
- **Status:** In use (#2): `.husky/`, `.lintstagedrc.json`, `commitlint.config.mjs`
- **Role:** Git hooks. Before a commit: lint and format the staged files. On the commit message: check Conventional Commits with a closed list of scopes (the modules plus `platform`, `shared`, `web`, `deps`).
- **Why:** problems are fixed before they reach a commit, and consistent commit messages keep history readable, which is graded. The closed scope list catches typos such as `vilage`. _Maintainability._
- **Alternatives:** CI only: slower feedback.
- **Cost:** a few seconds per commit. A new module or scope needs an update to `commitlint.config.mjs`.

---

## Testing

### Jest + ts-jest + Supertest + @nestjs/testing

- **Version:** jest 30.5.2, ts-jest 29.4.14, ts-node 10.9.2, supertest 7.3.1, @nestjs/testing 12.1.2, @types/jest 30.0.0, @types/supertest 7.2.1
- **Status:** In use (#2): `jest.config.ts` with three projects (`unit`, `integration`, `e2e`)
- **Role:** Jest runs the tests, and ts-jest compiles TypeScript for Jest. ts-node is needed only because Jest reads `jest.config.ts`. Supertest sends HTTP requests to the app in e2e tests, and @nestjs/testing builds the app or parts of it for a test.
- **Why:** this is the test stack of the official NestJS 12 CommonJS template, with good mocking and HTTP testing. One runner for all three test types. _Testability._
- **Alternatives:** Vitest: fast and ESM-native. The NestJS 12 _ESM_ template uses it, but we compile to CommonJS, where Jest is the template default.
- **Cost:** slower than Vitest. NestJS 12 packages are ES modules, so Jest runs under `node --experimental-vm-modules`, which prints an `ExperimentalWarning` and relies on an experimental Node feature.

### Type definitions

- **Version:** @types/node 24.19.2 (matches Node 24), @types/express 5.0.6
- **Status:** In use (#2)
- **Role:** types for Node APIs and for the Express request and response objects that NestJS exposes.
- **Why:** strict TypeScript needs types for every API we call. The @types/node major version matches the runtime, so we cannot call an API that Node 24 does not have. _Correctness._
- **Alternatives:** none.
- **Cost:** none.

### Testcontainers

- **Version:** testcontainers 12.2.0, @testcontainers/postgresql 12.2.0 (Node `>= 22.22`, CommonJS build)
- **Status:** In use (#3): `test/support/test-database.ts`, see [database.md](database.md#testing-against-the-database)
- **Role:** starts a real PostGIS container, with the same image and role init script as Compose and all migrations applied, for integration (one per file) and e2e tests (one per run).
- **Why:** the only way to test trigram, spatial and constraint behaviour honestly. _Correctness, testability._
- **Alternatives:** SQLite or in-memory fakes: they cannot run PostGIS or pg_trgm, and they give false confidence.
- **Cost:** Docker is needed for tests, and they are slower than unit tests (about 10–20 s to start a container once the image is cached).

---

## Data

### PostgreSQL 16

- **Version:** 16 (inside `postgis/postgis:16-3.5`)
- **Status:** In use (#3)
- **Role:** the system of record.
- **Why:** a relational database is mandatory, and PostgreSQL has the strongest extension ecosystem for our needs (spatial, fuzzy text, case-insensitive text). _Correctness, performance._
- **Alternatives:** MySQL: weaker spatial and fuzzy-text support.
- **Cost:** none significant.

### PostGIS

- **Version:** 3.5 (`postgis/postgis:16-3.5`, the newest PostGIS line published for PostgreSQL 16)
- **Status:** In use (#3), enabled by the baseline migration
- **Role:** village coordinates as `geography(Point,4326)`, distance and "nearby villages" queries, GiST indexes.
- **Why:** spatial queries with spatial indexes. _Performance, correctness._
- **Alternatives:** Haversine in application code: no index, slow and error-prone.
- **Cost:** an extension to install and learn.

### pg_trgm

- **Status:** In use (#3), enabled by the baseline migration
- **Role:** fuzzy search across Arabic and English spellings (بيت فوريك / بيت فوريق) with a GIN trigram index.
- **Why:** typo-tolerant, indexed search inside the database. _Performance, usability._
- **Alternatives:** `ILIKE '%x%'`: full scan, no typo tolerance. Elasticsearch: a whole extra system.
- **Cost:** index size, and the similarity threshold needs tuning.

### citext

- **Status:** In use (#3), enabled by the baseline migration
- **Role:** case-insensitive text for user emails.
- **Why:** the database enforces case-insensitive unique emails. _Correctness, security._
- **Alternatives:** `lower()` everywhere: easy to forget.
- **Cost:** needs a custom column type in Drizzle.

### Drizzle ORM + drizzle-kit + node-postgres (pg)

- **Version:** drizzle-orm 0.45.4, drizzle-kit 0.31.11, pg 8.23.1, @types/pg 8.23.1
- **Status:** In use (#3): `DatabaseModule`, `drizzle.config.ts`, `migrations/`. Conventions: [database.md](database.md).
- **Role:** Drizzle defines schemas and queries in TypeScript. drizzle-kit generates and checks migrations. `pg` is the driver. The API and the `migrate` service apply migrations with drizzle-orm's own migrator, so the runtime image does not need drizzle-kit.
- **Why:** an SQL-transparent ORM. We see the exact SQL, which matters for the 20% performance study. Constraints, partial indexes and GIN/GiST indexes are declared in TypeScript and land in migrations. Native SQL composes inside normal queries through the `sql` template. Custom types for PostGIS are easy. _Performance, maintainability._
- **Alternatives:** Prisma: friendlier for beginners, but hides SQL, has no PostGIS types, and partial indexes need hand-edited migrations. TypeORM: weaker result typing and a weaker maintenance history. Kysely: a query builder, and the brief requires an ORM.
- **Cost:** a steeper learning curve for SQL-shy members, and a smaller community than Prisma.
- **Why 0.45 and not 1.0:** the newest _stable_ releases are drizzle-orm 0.45.4 and drizzle-kit 0.31.11 (npm `latest`, checked 2026-10-12). 1.0 exists only as a release candidate (`1.0.0-rc.5`). It changes the migration folder layout and the relational query API, and `@nestjs-cls/transactional-adapter-drizzle-orm` (#9) supports both lines. We stay on stable and move to 1.0 when it is released. drizzle-kit can convert the migration folder (`drizzle-kit up`).
- **Node 24 and CommonJS:** drizzle-orm ships both CommonJS (`.cjs`) and ESM builds, and `pg` is CommonJS. `require('drizzle-orm/node-postgres')` resolves to `index.cjs`, so no flag is needed. drizzle-kit loads `drizzle.config.ts` and its TypeScript imports with its own bundled loader. Verified in #3 by the Compose stack, `npm run db:check` and the Testcontainers tests.

### Two database roles (owner and `qaryati_app`)

- **Status:** In use (#3): `docker/postgres/init/20-create-app-role.sh`, checked by `test/database-roles.int-spec.ts`. Grants: [database.md](database.md#roles).
- **Role:** the owner role runs migrations. The app connects as `qaryati_app` with DML rights only.
- **Why:** least privilege. Even if compromised, the running app cannot change the schema or delete audit history. _Security._
- **Alternatives:** one superuser connection: any bug or injection has full power.
- **Cost:** two connection strings to manage.

---

## Cache and queues

### Redis 7

- **Version:** `redis:7.4-alpine`
- **Status:** runs in Compose since #3. The API connects to it with the first feature that needs it (#9/#25).
- **Role:** shared cache, distributed rate limits, and later the BullMQ job queue.
- **Why:** one dependency covers all three, and it works with more than one API instance. _Performance, scalability._
- **Alternatives:** an in-process cache: breaks with more than one instance.
- **Cost:** one more service to run.

---

## Configuration

### zod + @nestjs/config

- **Version:** zod 4.6.6, @nestjs/config 12.0.1
- **Status:** In use (#3): `src/config/`, see [configuration.md](configuration.md)
- **Role:** load environment variables and validate them at startup. `@nestjs/config` 12 accepts any Standard Schema as `validationSchema`, so the zod schema is passed directly, with no custom `validate` function. Its error lists every invalid variable on its own line (`PORT: must be a number`).
- **Why:** the app refuses to start with a missing or malformed variable instead of failing later, and there is no hidden configuration (brief). _Correctness, security._
- **Alternatives:** reading `process.env` ad hoc: silent misconfiguration.
- **Cost:** a schema to keep in sync with `.env.example`. Tools outside Nest (the migration runner, drizzle-kit) validate with a second, smaller schema (`migrationEnvSchema`), so the API never sees the owner credentials.

---

## Containers

### Docker Compose

- **Version:** Compose v2 (`docker compose`); file `docker-compose.yml`
- **Status:** In use (#3): `db`, `redis`, one-shot `migrate`, `api`, all with health checks. See [development.md](development.md#running-with-docker).
- **Role:** starts the database, Redis, migrations and API locally with one command.
- **Why:** identical infrastructure for everyone, and Docker is mandatory in the brief. _Reproducibility._
- **Alternatives:** local installs: "works on my machine" problems.
- **Cost:** Docker is required on every laptop.

### Base images: node:24-slim, postgis/postgis:16-3.5, redis:7.4-alpine

- **Status:** In use (#3). The API image is a two-stage `Dockerfile` that runs as the `node` user. Dependabot proposes minor and patch image updates (#4).
- **Role:** runtime image of the API, the database, the cache.
- **Why:** official, pinned and small. The slim image uses glibc, which avoids the native-module issues seen on Alpine for Node. _Reliability, security._
- **Alternatives:** node:alpine: musl surprises with native modules.
- **Cost:** slightly larger than Alpine.

---

## CI and supply chain

### GitHub Actions

- **Version:** runner `ubuntu-24.04`; actions/checkout v7.0.1, actions/setup-node v7.1.0, each pinned to a commit SHA
- **Status:** In use (#4): `.github/workflows/ci.yml`, five jobs that are required checks on `main`. See [ci.md](ci.md).
- **Role:** runs the `quality`, `unit`, `integration`, `secrets` and `docker` jobs on every PR and on `main`.
- **Why:** every check runs on every PR, next to the code, and it is free for this use. Required checks turn "please run the tests" into a merge rule. _Correctness, maintainability._
- **Alternatives:** local discipline only: one forgotten run lets a broken change reach `main`. Other CI services (CircleCI, GitLab CI): a second system and a second login, for nothing GitHub Actions lacks here.
- **Cost:** CI minutes (free for public repositories), YAML to maintain, and SHA pins that Dependabot must keep current.

### gitleaks

- **Version:** 8.30.1, the release binary checked against its SHA-256
- **Status:** In use (#4): the `secrets` job scans the full history on every PR
- **Role:** scans the full Git history for committed secrets.
- **Why:** blocks committed secrets, which the brief forbids. It scans every commit, not only the diff, so a secret added and removed again inside a PR is still caught. _Security._
- **Alternatives:** manual review. `gitleaks-action`: needs a licence key for organisation repositories and adds a third-party action, while the plain binary does the same scan. GitHub secret scanning: a useful complement, but its availability depends on the repository's visibility and plan, and it is not a check we can require in CI.
- **Cost:** occasional false positives, handled with `.gitleaksignore`. Updating gitleaks means changing the version and checksum in `ci.yml` by hand, because Dependabot does not track it.

### Dependabot

- **Status:** In use (#4): `.github/dependabot.yml`, see [ci.md](ci.md#dependabot)
- **Role:** weekly update PRs (Sunday) for npm, GitHub Actions, the `Dockerfile` and the Compose images. In each ecosystem, minor and patch updates are grouped into one PR, with at most 3 open PRs. Docker major versions are ignored.
- **Why:** automatic dependency and security updates. _Security._
- **Alternatives:** manual upgrades.
- **Cost:** PR noise, handled weekly. Every update PR needs a review like any other PR.
