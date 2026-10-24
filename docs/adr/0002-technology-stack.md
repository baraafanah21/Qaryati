# ADR-002: Technology stack

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Decided by Baraa (platform lead); shared with the team in the team guide on 2026-10-12.
- **Issue:** #11

## Context

- The architecture is a modular monolith with hexagonal modules ([ADR-001](0001-modular-monolith-hexagonal-modules.md)), so the framework must support modules, dependency injection and ports.
- The brief requires a relational database, an ORM, Docker, and a performance study (20% of the grade), which needs the exact SQL to be visible.
- The data needs spatial queries (nearby villages), fuzzy Arabic and English name search, and case-insensitive emails.
- Five developers with mixed experience, about seven weeks. Tools must be mainstream, documented, and the same on every laptop.

This record covers the main choices only. Every library, with its version and full reasoning, is in [docs/tech-stack.md](../tech-stack.md); exact versions are pinned in `package.json`.

## Decision

The stack was set on 2026-10-11 (#1) and installed in #65 (runtime and framework), #66 (database and Compose) and #77 (transaction adapter, 2026-10-18).

| Area               | Choice                                                        | Why, in one line                                                                                                                                      |
| ------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime, language  | Node.js 24 LTS, TypeScript 6 (strict)                         | Long LTS support; types are contracts between five developers and nine modules.                                                                       |
| Framework          | NestJS 12 on CommonJS                                         | Nest modules map to our modules; DI fits ports and adapters; guards and pipes centralise auth and validation.                                         |
| Database           | PostgreSQL 16 + PostGIS + pg_trgm + citext                    | Relational is mandatory; spatial queries with GiST indexes; typo-tolerant name search with GIN trigram indexes; case-insensitive unique emails.       |
| ORM                | Drizzle ORM 0.45 (+ drizzle-kit, node-postgres)               | SQL stays visible; constraints and partial/GIN/GiST indexes live in the schema; PostGIS custom types; native SQL composes through the `sql` template. |
| Transactions       | `@nestjs-cls/transactional` with our `PgTransactionalAdapter` | One transaction across modules that each see only their own tables.                                                                                   |
| Validation, config | zod                                                           | One library for requests and environment; `@nestjs/swagger` 12 generates OpenAPI schemas from zod without a bridge.                                   |
| Cache and queues   | Redis 7                                                       | One service for cache, distributed rate limits and the job queue.                                                                                     |
| Tests              | Jest + Supertest + Testcontainers                             | Jest is the NestJS default for CommonJS; Testcontainers runs a real PostGIS.                                                                          |
| Environment        | Docker Compose                                                | The same database, Redis and API for everyone with one command; required by the brief.                                                                |

Notes on the choices that needed a real trade-off:

- **TypeScript 6, not 7.** TypeScript 7 (the Go compiler) is out, but typescript-eslint and ts-jest do not support it yet. We move when they do.
- **CommonJS on an ESM-first framework.** NestJS 12 ships as ES modules, but its official template still offers CommonJS + Jest, and Node 24 loads ES modules through `require()`. Staying on CommonJS keeps Jest and avoids `.js` import extensions and ESM friction for the team. The cost is one flag for Jest (`--experimental-vm-modules`).
- **Drizzle 0.45, not 1.0.** 1.0 is still a release candidate that changes the migration layout and the relational query API. We stay on the stable line.
- **Our own transaction adapter.** The official Drizzle adapter wraps one Drizzle instance's `transaction()`. With one instance per module (ADR-001), that means either separate transactions per module (no common rollback) or one shared schema (no isolation). Our adapter opens the transaction on the `pg` connection and each module builds its schema-limited instance on it. Measured overhead (#77): the handle adds 0–25 ns per query-builder access; building an instance costs about 2.2 µs and is cached per connection. A database round trip is hundreds of microseconds.
- **Redis** runs in Compose today. Its first use is rate limiting (#25), then the job queue (#41) and the details cache (#45).

## Alternatives considered

| Option                               | Pros                                      | Cons                                                                                                     | Why rejected                                                                                     |
| ------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| TypeScript 7                         | Much faster compiler                      | typescript-eslint and ts-jest do not support it yet                                                      | Would break lint and tests today.                                                                |
| Express (or Fastify) alone           | Small, flexible                           | No modules, no DI, no shared conventions                                                                 | Each member would invent their own structure.                                                    |
| NestJS on ESM + Vitest               | ESM-native, faster tests                  | `.js` extensions on every import, a different test runner                                                | Friction for the team with nothing gained at runtime.                                            |
| MySQL                                | Widely known                              | Weaker spatial and fuzzy-text support                                                                    | Our core queries (nearby villages, fuzzy names) need PostGIS and pg_trgm.                        |
| Prisma                               | Friendly for beginners, large community   | Hides the SQL, no PostGIS types, partial indexes need hand-edited migrations                             | Conflicts with the performance study and with constraints in the schema.                         |
| TypeORM                              | Long-standing Nest default                | Weaker result typing, weaker maintenance history                                                         | Less type safety for nine modules written by five people.                                        |
| MikroORM                             | Built-in optimistic locking, Unit of Work | The Unit of Work defers writes and hides when and which SQL runs; fewer examples and a smaller community | Against SQL transparency for the performance study; we cover optimistic locking with one helper. |
| Kysely                               | Excellent typed SQL                       | A query builder, not an ORM                                                                              | The brief requires an ORM.                                                                       |
| Official Drizzle transaction adapter | No code of our own                        | Bound to one Drizzle instance                                                                            | Separate transactions per module or a shared schema (see above).                                 |
| class-validator                      | Long-standing Nest default                | A second validation library next to zod; DTO classes repeat the types                                    | zod already validates config, and Swagger 12 reads zod directly.                                 |
| In-process cache                     | No extra service                          | Breaks with more than one API instance                                                                   | Rate limits and cache must be shared.                                                            |
| SQLite or mocks in tests             | Fast, no Docker                           | Cannot run PostGIS or pg_trgm; false confidence                                                          | The queries that matter most could not be tested.                                                |
| Local installs instead of Compose    | Nothing to learn                          | "Works on my machine"                                                                                    | Docker is required by the brief, and environments must match.                                    |

## Consequences

### Positive

- The SQL behind every query is visible, which the performance study and index work need.
- Constraints, spatial and trigram indexes are declared in TypeScript and land in reviewed migrations.
- One validation library and one source for request types, validation and API docs.
- A module change and its audit entry share one transaction, with module isolation kept.
- Integration tests run against the same PostGIS image as Compose.

### Negative

- Learning curve: NestJS concepts, Drizzle (smaller community than Prisma), PostGIS and trigram tuning.
- Docker is needed on every laptop, for Compose and for integration tests (Testcontainers), and those tests are slower.
- Tooling pins: TypeScript stays on 6 until typescript-eslint and ts-jest support 7; Drizzle stays on 0.45 until 1.0 is stable; Jest needs `--experimental-vm-modules`.
- About 170 lines of our own transaction code (adapter and module handle) to maintain, covered by tests.
- Major updates of core dependencies need their own issue (Dependabot holds them back).

### Follow-up

- #25 connects Redis (rate limits), #41 adds BullMQ, #45 adds the Redis details cache.
- Revisit TypeScript 7 and Drizzle 1.0 when their tooling is ready, in a new ADR if the decision changes.

## How it is enforced or verified

- `package.json` pins exact versions (`save-exact`), and `.nvmrc` plus `engines` pin Node 24; Docker and CI use the same.
- CI on every pull request: Prettier, ESLint, TypeScript, dependency-cruiser, `drizzle-kit check`, schema drift, OpenAPI drift, unit, integration (Testcontainers) and e2e tests, and a full `docker compose up` with a health check.
- `test/extensions.int-spec.ts` proves PostGIS distance search and pg_trgm fuzzy Arabic search work and use their indexes. `test/transactions.int-spec.ts` proves the transaction adapter (one rollback for two modules, isolation, no connection leak).
- Dependabot opens updates; majors of core packages need an issue first.

## Related

- [docs/tech-stack.md](../tech-stack.md): every technology with version, role, reasons, alternatives and cost
- [docs/database.md](../database.md): roles, migrations, the transaction design
- [docs/development.md](../development.md): setup, scripts and tests
- [ADR-001](0001-modular-monolith-hexagonal-modules.md): architecture
- Issues and PRs: #1 (bootstrap, first stack doc), #65 (NestJS skeleton), #66 (Docker Compose and Drizzle), #67 (CI), #77 (transaction adapter and Swagger), #11 (this ADR)
