# Database

PostgreSQL 16 with PostGIS, pg_trgm and citext, accessed through Drizzle ORM and node-postgres. This page covers the roles, migrations, how modules declare and query tables, and how the database is tested.

## Roles

Two roles, so that the running API has only the rights it needs ([least privilege](tech-stack.md#two-database-roles-owner-and-qaryati_app)).

| Role                                     | Created by                                                                                    | Used by                           | Rights                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| Owner (`POSTGRES_USER`, `qaryati_owner`) | the postgres image, on first start                                                            | `migrate` service, `npm run db:*` | Owns the database and every table. Creates extensions, tables, indexes.              |
| `qaryati_app`                            | [`docker/postgres/init/20-create-app-role.sh`](../docker/postgres/init/20-create-app-role.sh) | the API (`DATABASE_URL`)          | `CONNECT`; `SELECT, INSERT, UPDATE, DELETE` on tables, `USAGE, SELECT` on sequences. |

What the init script sets up:

- `qaryati_app` is `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`.
- `PUBLIC` loses every database privilege (`CONNECT`, `TEMP`) and `CREATE` on schema `public`. Only the owner and `qaryati_app` can connect, and only the owner can create objects.
- `ALTER DEFAULT PRIVILEGES FOR ROLE <owner>` grants DML on every table and sequence **the owner creates later**. Each new migration is therefore usable by the API without a manual `GRANT`.
- `TRUNCATE`, `REFERENCES` and `TRIGGER` are not granted, and neither is anything on the `drizzle` schema that records applied migrations.

As a result, `qaryati_app` cannot `CREATE`, `ALTER`, `DROP` or `TRUNCATE` anything (SQLSTATE `42501`). `test/database-roles.int-spec.ts` checks each of these. A table can later take back rights from `qaryati_app` with a `REVOKE` in its migration. For example, the audit trail (#20) will allow only `INSERT` and `SELECT`.

At startup, `DatabaseModule` runs `SELECT current_user` and logs `Connected to PostgreSQL as qaryati_app`. A wrong URL or password stops the app at startup, not at the first request.

In Docker Compose the owner is the image's `POSTGRES_USER`, which is a superuser inside the container. That is needed because `CREATE EXTENSION postgis` requires a superuser. A production database would use a non-superuser owner, with the extensions created once by an administrator.

## Extensions

The baseline migration [`migrations/0000_baseline.sql`](../migrations/0000_baseline.sql) enables:

| Extension | Used for                                                                    |
| --------- | --------------------------------------------------------------------------- |
| `postgis` | `geography(Point,4326)` locations, distances, nearby villages, GiST indexes |
| `pg_trgm` | Typo-tolerant search over Arabic and English names, GIN trigram indexes     |
| `citext`  | Case-insensitive unique emails                                              |

It uses `CREATE EXTENSION IF NOT EXISTS`. The `postgis/postgis` image already creates `postgis` (and a few PostGIS add-ons) in `POSTGRES_DB` on first start, and on any other server the migration creates it.

## Schema per module

Each module declares its own tables in `src/modules/<module>/infrastructure/persistence/schema.ts`. [`drizzle.config.ts`](../drizzle.config.ts) collects them with one glob:

```ts
schema: './src/modules/*/infrastructure/persistence/schema.ts',
```

A new module or table therefore needs no change to a shared file. `profile` owns no tables, so it has no `schema.ts`.

Conventions:

- **Casing.** Drizzle runs with `casing: 'snake_case'`, both in `drizzle.config.ts` and in `DatabaseModule`. Declare properties in camelCase without explicit column names. `displayName: text()` becomes the column `display_name`.
- **Only the owning module edits its `schema.ts`.** Other modules reach the data through the owner's `index.ts` facade. dependency-cruiser rejects imports of another module's internals, `schema.ts` included.
- **Constraints belong in the schema**, not only in application code: `notNull`, `unique`, `check`, foreign keys, partial and GIN/GiST indexes.

## Querying: the `DRIZZLE` instance

[`DatabaseModule`](../src/platform/database/database.module.ts) is global and provides one Drizzle instance, connected as `qaryati_app`. A repository in a module's `infrastructure/` injects it:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../../../platform/database/database';
import { village } from './schema';

@Injectable()
export class DrizzleVillageRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findBySlug(slug: string) {
    return this.db.select().from(village).where(eq(village.slug, slug));
  }
}
```

`Database` is `NodePgDatabase` **without a combined schema**, on purpose. Query results are typed from the table objects passed in (`db.select().from(village)`), and a module can import only its own tables. A combined schema would enable `db.query.<anyTable>` and let every module read every other module's tables without any import that dependency-cruiser could catch. The cost is that Drizzle's relational query API (`db.query.x.findMany({ with })`) is not available. Joins are written with the query builder instead, which also keeps the SQL visible.

### Native SQL

For trigram search, PostGIS and statistics, use Drizzle's `sql` template inside normal queries. Values are sent as parameters:

```ts
db.select()
  .from(village)
  .where(sql`${village.name} % ${term}`);
```

Never build SQL by string concatenation.

## Migrations

Migrations live in [`migrations/`](../migrations/). Drizzle-kit generates them, they are reviewed like code, and they are applied in order.

| Command                                    | What it does                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `npm run db:generate`                      | Compares the `schema.ts` files with `migrations/meta` and writes a new SQL migration.          |
| `npm run db:generate -- --custom --name=x` | Writes an empty migration for hand-written SQL (extensions, data fixes).                       |
| `npm run db:migrate`                       | Applies pending migrations to the database in `DATABASE_OWNER_URL` (the Compose database).     |
| `npm run db:check`                         | Checks that the migration history is consistent (for example after a merge).                   |
| `npm run db:drift`                         | Fails if a `schema.ts` change has no generated migration. CI runs it ([ci.md](ci.md#quality)). |
| `npm run db:studio`                        | Opens Drizzle Studio on the owner connection, for browsing data locally.                       |

All four read `DATABASE_OWNER_URL` from `.env`, so copy `.env.example` first.

Workflow:

1. Change your module's `schema.ts`.
2. `npm run db:generate`, then **read the generated SQL**. Check locks, defaults on large tables and anything irreversible.
3. `npm run db:migrate` against your local Compose database, then run the tests.
4. Commit the schema change, the SQL file and the `migrations/meta` changes together.

Rules:

- **Never edit a migration that is already on `main`.** Fix forward with a new migration.
- If `main` gained a migration while your branch was open: rebase, delete your migration, run `db:generate` again.
- `migrations/meta/` is generated by drizzle-kit and excluded from Prettier, so formatting never changes its content.

How migrations are applied:

- **Compose:** the one-shot `migrate` service runs `node dist/platform/database/migrate.js` from the API image as the owner role, then exits. `api` starts only after it exits successfully.
- **Tests:** `runMigrations()` from the same file.
- Applied migrations are recorded in `drizzle.__drizzle_migrations`, so a second run does nothing. Pending migrations are applied in one transaction: either all of them apply, or none do.

## Testing against the database

Integration and e2e tests use a real PostGIS container through [Testcontainers](https://testcontainers.com/). The database is never mocked (CONTEXT.md).

[`test/support/test-database.ts`](../test/support/test-database.ts) starts the same image as Compose, with the same role init script, and runs all migrations. It returns both URLs:

```ts
const db = await startTestDatabase(); // { ownerUrl, appUrl, stop() }
```

- **Integration tests** (`*.int-spec.ts`) start one container per test file in `beforeAll` and stop it in `afterAll`. Test files stay isolated from each other.
- **E2E tests** (`*.e2e-spec.ts`) share one container per run, started by `test/support/e2e-global-setup.ts`. `AppModule` validates the environment as soon as it is imported, so `DATABASE_URL` must be set before any e2e test file loads.
- A test that needs `ConfigService` without the whole app calls `createAppConfigModule()` after setting `process.env.DATABASE_URL` (see `test/database-module.int-spec.ts`).
- Test tables are created by the owner client, the way a migration would create them, and the code under test uses `qaryati_app`. That keeps the grants under test too.

Docker must be running. The first run pulls `postgis/postgis:16-3.5`, which takes a while, and later runs need about 10–20 seconds per container.
