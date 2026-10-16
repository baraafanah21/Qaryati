# CONTEXT.md: Qaryati

## Language

Talk to the human in Arabic. Write everything in the repository and on GitHub in English: code, comments, docs, commits, branch names, issue and PR text.

## Project

Qaryati is an API-only NestJS backend for sourced, verifiable knowledge about Palestinian villages. University project, 5 members, deadline 2026-12-01. The plan is in docs/plan/issues.json; the GitHub issues are the source of truth for scope.

## Architecture rules (enforced by dependency-cruiser in CI)

- Modular monolith; modules: village, population, heritage, economy, curation, audit, iam, geo, profile. Kernel in src/shared/kernel (plain TypeScript: errors and error codes, Clock, Id/IdGenerator, Page<T>; domain event types and the AuditRecorder port follow in #9 part 2), technical cross-cutting code in src/platform (http, logging, database, kernel port implementations). How to use them: docs/kernel.md.
- Module dependency directions (no cycles; see docs/architecture.md): iam -> none; curation -> iam; audit -> none (implements the AuditRecorder port from shared; nobody imports audit); village -> iam, curation; population, heritage, economy, geo -> iam, curation, village; profile -> iam, curation, village, population, heritage, economy (read-only composition; nobody imports profile). Every module may import shared.
- village never depends on content modules. Curation reaches content tables only through ClaimHandlers that content modules register with it.
- web/ is a separate client (React, issues #61-#64, milestone UI, not graded). It talks to the API over HTTP only, through a client generated from openapi.json, and never imports from src/. It has its own package.json and CI job, and the backend dependency-cruiser rules do not cover it.
- Inside a module: web -> application -> domain; infrastructure implements ports declared in domain/application.
- domain is plain TypeScript: no @nestjs, drizzle-orm, pg, ioredis, express, and no imports from web/application/infrastructure. From src/shared and src/platform it may import only src/shared/kernel, which itself imports no npm package.
- domain and application never call new Date(), Date.now(), randomUUID() or uuid: inject CLOCK and ID_GENERATOR (ESLint enforces it).
- Errors: throw the kernel's DomainError subclasses (NotFoundError, ConflictError, ...) with a code from ErrorCode; the global filter returns application/problem+json. A new code gets a section in docs/errors.md in the same PR (a unit test checks it).
- Requests: zod schemas with z.strictObject, passed as @Body/@Query/@Param({ schema }). Lists use paginationQuery and sortQuery with an allow-list, and return Page<T> via toPage.
- Cross-module access only through the other module's index.ts or domain events. Never import another module's repositories, tables or internals.
- Each module owns its tables in src/modules/<m>/infrastructure/persistence/schema.ts. Never edit another module's schema file.
- Facts are claims: a source, a verification status and an author. Never overwrite a fact in place; add a new claim.
- The allowed module directions live in two places that must stay identical: ALLOWED in .dependency-cruiser.cjs and the "Dependency directions" table in docs/architecture.md.
- Relative imports only, no path aliases. Import another module through its folder (../../village), which resolves to its index.ts.
- src/app.module.ts is the composition root and the only file that imports every module's Nest module.

## Data access

- Drizzle ORM for normal reads and writes; native SQL via Drizzle's sql template for trigram search, PostGIS and statistics. Never build SQL by string concatenation.
- Migrations: change schema.ts, run npm run db:generate, review the generated SQL, commit it. Never edit a migration that is already on main. If main gained a migration while your branch was open, rebase, delete yours, regenerate.
- The app connects as qaryati_app (DML only). Migrations run as the owner role. The API never receives DATABASE_OWNER_URL.
- Each module imports DatabaseModule.forFeature(schema) with its own schema.ts; repositories inject it with @InjectModuleDb() db: ModuleDb<typeof schema>. db.query (relational queries) sees only the module's own tables, and every instance shares one pool. There is no combined schema.
- Drizzle uses casing: 'snake_case'. Declare columns in camelCase without explicit names.
- Only src/config may read process.env. A new variable goes into the zod schema, .env.example and docs/configuration.md in the same PR.

## Workflow

- issue -> branch (feature|chore|fix|docs|ci/<issue>-<slug>) -> PR with "Closes #<n>" using the template -> review by Baraa -> squash merge. Never push to main.
- Conventional Commits with the module as scope, e.g. feat(population): add record rules.
- Before pushing: npm run format:check && npm run lint && npm run typecheck && npm run depcruise && npm run db:check && npm run db:drift && npm run test:unit && npm run test:int && npm run test:e2e (the same checks as CI, docs/ci.md). The five CI jobs are required checks on main; renaming a job means updating REQUIRED_CHECKS in scripts/github-bootstrap.sh.
- Do only what the issue's acceptance criteria ask. Ask before widening scope.
- Never commit secrets or .env files.
- AI assistants prepare changes locally and never commit, push or run commands that change GitHub. Team members run those commands themselves, so every commit and every GitHub action belongs to a person.

## Documentation (part of done)

- Every PR updates the docs it affects: docs/README.md index, architecture, tech-stack, workflow, development, configuration, database, ci, module README.md files.
- Any new dependency or tool gets an entry in docs/tech-stack.md in the same PR: what it does here, why chosen, alternatives rejected, cost accepted.
- TSDoc on every exported class, function, port and facade method. Comments explain why, not what.
- When a convention in this file changes, update this file in the same PR.

## Testing

- Unit tests for domain rules and pure helpers, no framework, no database.
- Integration tests against real PostGIS via Testcontainers (test/support/test-database.ts: same image, role script and migrations as Compose); do not mock the database or Redis. Code under test connects as qaryati_app.
- Every bug fix comes with a test that fails before the fix.

## Commands

npm run start:dev | build | lint | format | typecheck | depcruise
npm run test:unit | test:int | test:e2e | test:cov
npm run db:generate | db:migrate | db:check | db:studio
cp .env.example .env && docker compose up -d --build --wait
