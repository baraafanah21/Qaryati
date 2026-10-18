# Kernel usage guide

How to do the everyday things in an endpoint: one way each, copy and adapt. New to this? Start with [Build a new endpoint in 10 steps](#build-a-new-endpoint-in-10-steps), which walks through the reference module in [`test/reference-module`](../test/reference-module). The pieces live here:

| Where                                                | What                                                                                                                                                            | Who may import it                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [`src/shared/kernel`](../src/shared/kernel/index.ts) | Plain TypeScript: errors and codes, `Clock`, `Id`/`IdGenerator`, `Page<T>`, `Versioned`, `DomainEvent` + `DomainEventPublisher`, `AuditRecorder` port           | every layer, **including `domain/`**  |
| `@nestjs-cls/transactional`                          | `@Transactional()`                                                                                                                                              | `application/` (use cases)            |
| [`src/platform/http`](../src/platform/http)          | Nest pieces: problem filter, validation pipe, `paginationQuery`, `sortQuery`, `pageResponse`, request ID, `@ETag()`, `@IfMatch()`, `@ApiModule`, `@ApiProblems` | `web/` (controllers)                  |
| [`src/platform/database`](../src/platform/database)  | `DatabaseModule.forFeature`, `@InjectModuleDb()`, `ModuleDb<S>`, `versionColumns()`, `updateWithVersion`, `softDeleteWithVersion`                               | the module file and `infrastructure/` |
| [`src/platform/events`](../src/platform/events)      | `@OnDomainEvent(name)` for listeners                                                                                                                            | `infrastructure/` (listeners)         |
| [`src/platform/context`](../src/platform/context)    | `RequestContext`: request ID and actor ID                                                                                                                       | platform code, the auth guard (#10)   |
| [`src/platform/logging`](../src/platform/logging)    | pino setup (nothing to import day to day)                                                                                                                       | AppModule only                        |

Import the kernel through its index: `import { NotFoundError } from '../../../shared/kernel';`.

## Throwing errors

Throw a kernel error from `domain/` or `application/`. The global filter turns it into an `application/problem+json` response ([errors.md](errors.md)); you never build an error response yourself.

```ts
import {
  BusinessRuleViolationError,
  ConflictError,
  ErrorCode,
  FieldErrorCode,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/kernel';

// 404 NOT_FOUND
throw new NotFoundError(`Village ${id} does not exist.`);

// 409 DUPLICATE
throw new ConflictError(`The slug ${slug} is already taken.`);

// 422 VALIDATION_FAILED, with errors[]
throw new ValidationError('The slug is invalid.', [
  { field: 'slug', code: FieldErrorCode.INVALID_FORMAT, message: 'Use a-z, 0-9 and -.' },
]);

// 403 FORBIDDEN
throw new ForbiddenError('You cannot verify your own claim.');

// 412 VERSION_CONFLICT
throw new PreconditionFailedError(`The village changed since version ${version}.`);

// 422 CONSTRAINT_VIOLATION by default; pass a module code when clients must tell rules apart
throw new BusinessRuleViolationError('A village needs an Arabic name.', {
  code: ErrorCode.CONSTRAINT_VIOLATION,
});
```

`detail` is the message, so write it for the API client, in English, without internal names.

**Check existence before inserting.** If a child row points to a missing parent, the database answers with a foreign key error, which becomes a generic 409 `REFERENCE_CONFLICT`. Look the parent up first and throw `NotFoundError`, so the client gets a 404 that names what is missing:

```ts
if (!(await this.villages.exists(villageId)))
  throw new NotFoundError(`Village ${villageId} does not exist.`);
```

Unique, foreign key, check and not-null violations that still reach the database are mapped for you (409/409/422/422; a statement timeout is 503). The SQL and constraint names go to the log only.

**Don't:** `throw new HttpException(...)` or `NotFoundException` from `domain/` or `application/`. The domain does not know HTTP, and dependency-cruiser rejects `@nestjs` imports in `domain/`.

## Adding an error code

A client needs to tell your failure apart from others (for example `SELF_VERIFICATION`):

```ts
// src/shared/kernel/errors/error-codes.ts
export const ErrorCode = {
  // ...
  SELF_VERIFICATION: 'SELF_VERIFICATION',
} as const;
```

Then add its title to `ERROR_TITLES` in `src/platform/http/problem-details.ts` (the compiler asks for it) and a section with `<a id="self-verification"></a>` in [errors.md](errors.md). `npm run test:unit` fails until the section exists. Throw it with the category that gives the right status: `new BusinessRuleViolationError('...', { code: ErrorCode.SELF_VERIFICATION })`.

Field codes (`errors[].code`) work the same way in `FieldErrorCode` and the field code table in errors.md.

**Don't:** put a code in a string literal (`code: 'SELF_VERIFY'`): it is not in the catalogue, not documented, and TypeScript rejects it.

## Validating a request

Request schemas are zod schemas, passed to the parameter decorator. The global pipe validates, converts types and answers 400 `VALIDATION_FAILED` with `errors[]`. Swagger reads the same schema, so the docs never drift from the validation ([Documenting an endpoint](#documenting-an-endpoint-swagger)).

```ts
// web/village.schemas.ts
import { z } from 'zod';
import { FieldErrorCode } from '../../../shared/kernel';

export const createVillageBody = z.strictObject({
  slug: z.string().min(3).max(80).regex(/^[a-z0-9-]+$/),
  names: z
    .array(z.strictObject({ lang: z.enum(['ar', 'en']), value: z.string().min(1).max(200) }))
    .min(1)
    .refine((names) => names.some((n) => n.lang === 'ar'), {
      params: { code: FieldErrorCode.NOT_ALLOWED },
      message: 'At least one Arabic name is required.',
    }),
});
export type CreateVillageBody = z.infer<typeof createVillageBody>;

// web/village.controller.ts
@Post()
create(@Body({ schema: createVillageBody }) body: CreateVillageBody) { ... }

@Get(':id')
findOne(@Param('id', { schema: idParam }) id: string) { ... }  // idParam from platform/http/pagination
```

- Use `z.strictObject` for every object, nested ones too: unknown properties must be rejected. The pipe refuses a loose `z.object` with a 500 on the route's first call, so your first test catches it.
- Query and path values arrive as strings. Use `z.coerce.number()` / `z.coerce.boolean()`, and the handler receives real numbers.
- A rule-specific failure sets `params: { code: FieldErrorCode.X }` on `refine`/`superRefine`; its `message` is kept. Every other failure gets a stable code (`REQUIRED`, `TOO_LONG`, ...) and our message, never zod's wording.
- Rules that depend on the current time ("must not be in the future") belong in the domain, which has the `Clock`: `throw new ValidationError('...', [{ field: 'depopulatedOn', code: FieldErrorCode.MUST_NOT_BE_FUTURE, message: '...' }])`.

**Don't:** validate by hand in the controller or service (`if (!body.slug) throw ...`). Shape checks belong in the schema; the domain checks business rules.

## Paginating and sorting a list endpoint

```ts
// web/village.schemas.ts
import { paginationQuery, sortQuery } from '../../../platform/http/pagination';

export const listVillagesQuery = paginationQuery.extend({
  q: z.string().max(100).optional(),
  sort: sortQuery(['name', 'createdAt'], [{ field: 'name', direction: 'asc' }]), // allow-list + default
});
export type ListVillagesQuery = z.infer<typeof listVillagesQuery>;

// web/village.controller.ts
@Get()
list(@Query({ schema: listVillagesQuery }) query: ListVillagesQuery): Promise<Page<VillageSummary>> {
  return this.villages.search(query);
}

// infrastructure/drizzle-village.repository.ts
import { pageOffset, toPage, type Page, type PageRequest, type Sort } from '../../../shared/kernel';

// The allow-list again, now as columns: the only way a sort field reaches SQL.
const SORT_COLUMNS = { name: village.name, createdAt: village.createdAt };

async search(query: PageRequest & { sort: Sort<'name' | 'createdAt'>[] }): Promise<Page<VillageSummary>> {
  const order = query.sort.map((s) => (s.direction === 'asc' ? asc : desc)(SORT_COLUMNS[s.field]));
  const [rows, [{ total }]] = await Promise.all([
    this.db.select().from(village).orderBy(...order, asc(village.id)).limit(query.size).offset(pageOffset(query)),
    this.db.select({ total: count() }).from(village), // same filters as the page query
  ]);
  return toPage(rows, total, query);
}
```

- `?page=` is zero-based (default 0), `?size=` is 1–100 (default 20). `size=500` is a 400, not silently 100.
- `?sort=name,desc&sort=createdAt` (direction defaults to `asc`). A field outside the allow-list is a 400 with `NOT_ALLOWED`. Allow only fields you have an index for.
- Add a unique column (`id`) as the last sort key so pages are stable.
- The response is `{ content: [...], page: { number, size, totalElements, totalPages } }`.
- Keyset (cursor) pagination is not needed yet. The audit API (#20) will add it for its append-only, fast-growing table.

**Don't:** interpolate a sort field into SQL with `sql.raw`, or read a column by a name the client chose without the allow-list. The allow-list is what keeps the column name safe.

## Getting the module database

Each module gets a Drizzle instance on the shared pool that knows only its own schema, so relational queries work inside the module and other modules' tables do not exist for it ([database.md](database.md#querying-the-module-database)).

```ts
// infrastructure/persistence/village-db.ts
import type { ModuleDb } from '../../../../platform/database/database';
import type * as schema from './schema';
export type VillageDb = ModuleDb<typeof schema>;

// village.module.ts
import { DatabaseModule } from '../../platform/database/database.module';
import * as schema from './infrastructure/persistence/schema';

@Module({ imports: [DatabaseModule.forFeature(schema)], providers: [...] })
export class VillageModule {}

// infrastructure/drizzle-village.repository.ts
@Injectable()
export class DrizzleVillageRepository implements VillageRepository {
  constructor(@InjectModuleDb() private readonly db: VillageDb) {}

  findBySlug(slug: string) {
    return this.db.query.village.findFirst({ where: eq(village.slug, slug), with: { names: true } });
  }
}
```

The injected `db` is a handle, not a fixed connection: inside a `@Transactional()` use case every query runs on the transaction's client, outside it on the pool ([Transactions](#transactions)). Repositories never see a transaction.

**Don't:** create your own `Pool` or call `drizzle()` in a module. Every module shares the one pool, and transactions only cover queries made through the handle. `db.transaction()` throws on purpose: transactions belong to use cases.

## Transactions

Put `@Transactional()` on the use case method that writes. Everything it awaits, in any module, runs in one PostgreSQL transaction: `COMMIT` when the method returns, `ROLLBACK` when it throws.

```ts
// application/create-village.use-case.ts
import { Transactional } from '@nestjs-cls/transactional';

@Injectable()
export class CreateVillage {
  constructor(
    @Inject(VILLAGE_REPOSITORY) private readonly villages: VillageRepository,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
  ) {}

  @Transactional()
  async execute(input: CreateVillageInput): Promise<Village> {
    const village = await this.villages.insert(Village.create({ ... }));
    await this.audit.record({ action: 'village.created', entityType: 'Village', entityId: village.id, after: village.snapshot() });
    return village; // COMMIT here; any throw above rolls back both writes
  }
}
```

- **Repositories take no `tx` argument.** The module handle (`@InjectModuleDb()`) finds the active transaction in the request context by itself, and still exposes only the module's own tables, relational queries included.
- **Calls join.** A `@Transactional()` method called from another one joins the outer transaction (propagation `REQUIRED`): one `BEGIN`, one `COMMIT`. A facade of another module that is `@Transactional()` joins yours too. Savepoints are not supported.
- **Reads** that run a single query need no transaction. Use one when several reads must see the same snapshot.
- **Errors:** throw a kernel error; the rollback happens before the filter answers. A database error (unique violation, ...) also rolls back and is mapped as usual.
- Keep transactions short: no HTTP calls to other services (geocoding) inside one.

How it works and why: [database.md](database.md#transactions). Tests: `test/transactions.int-spec.ts`.

**Don't:** call `db.transaction()` (it throws), open a transaction in a controller or repository, or catch an error inside the use case and carry on: the transaction is already marked to fail at the database if a statement failed.

## Optimistic locking: version, ETag and If-Match

Every aggregate a client can change carries `version: number` (`Versioned` in the kernel). The client reads it as the `ETag`, sends it back in `If-Match`, and the write succeeds only if nobody changed the row in between. Otherwise the client gets 412 and must read again. No lost updates, no locks held between requests.

```ts
// infrastructure/persistence/schema.ts
export const village = pgTable('village', {
  id: uuid().primaryKey(),
  slug: text().notNull(),
  ...versionColumns(), // version (default 1), createdAt, updatedAt, deletedAt
});

// infrastructure/drizzle-village.repository.ts
@Injectable()
export class DrizzleVillageRepository implements VillageRepository {
  constructor(
    @InjectModuleDb() readonly db: VillageDb,
    @Inject(CLOCK) readonly clock: Clock, // public: `this` is the helpers' context
  ) {}

  async update(entity: Village, expectedVersion: number): Promise<Village> {
    return toDomain(await updateWithVersion(this, village, entity.id, expectedVersion, { slug: entity.slug }));
  }

  async softDelete(id: Id<'Village'>, expectedVersion: number): Promise<void> {
    await softDeleteWithVersion(this, village, id, expectedVersion);
  }
}

// web/village.controller.ts
@Get(':id')
@ETag() // ETag: "<version>" from the returned body
get(@Param('id', { schema: idParam }) id: string): Promise<VillageResponse> { ... }

@Patch(':id')
@ETag()
update(@Param('id', { schema: idParam }) id: string, @IfMatch() expectedVersion: number, @Body(...) body: UpdateVillageBody) { ... }

@Delete(':id')
@HttpCode(204)
remove(@Param('id', { schema: idParam }) id: string, @IfMatch() expectedVersion: number) { ... }
```

`updateWithVersion(ctx, table, id, expectedVersion, values)` runs one statement:

```sql
UPDATE village SET slug = $3, version = version + 1, updated_at = <clock>
WHERE id = $1 AND version = $2 AND deleted_at IS NULL RETURNING *
```

| Outcome                             | Result                                             |
| ----------------------------------- | -------------------------------------------------- |
| one row                             | the updated row, with the new version              |
| no row; the id is missing/deleted   | `NotFoundError` → 404 `NOT_FOUND`                  |
| no row; the row has another version | `PreconditionFailedError` → 412 `VERSION_CONFLICT` |

`softDeleteWithVersion` does the same with `deleted_at = <clock>`. Of two concurrent writes with the same version, exactly one wins: the second waits for the first's row lock, then matches nothing.

| HTTP                                                                  | Response                                        |
| --------------------------------------------------------------------- | ----------------------------------------------- |
| `GET`, `POST` (create), `PATCH` of one resource                       | `ETag: "3"` (strong tag, the version in quotes) |
| `PATCH`/`DELETE` without `If-Match`                                   | 428 `PRECONDITION_REQUIRED`                     |
| `If-Match` not exactly one tag like `"3"` (`W/"3"`, `*`, `3`, a list) | 400 `VALIDATION_FAILED`, field `If-Match`       |
| `If-Match` with an old version                                        | 412 `VERSION_CONFLICT`                          |

The domain never increments `version`; the database does, and `update` returns the stored aggregate with the new value. Tests: `test/optimistic-locking.int-spec.ts`, and the PATCH/DELETE cases in `test/reference-module/widget.e2e-spec.ts`.

**Don't:** take the version from the request body, write `UPDATE ... SET version = $n` yourself, or read-check-write the version in two statements: only the `WHERE version = $2` in the same `UPDATE` is safe under concurrency.

## Domain events

A use case announces what happened; other modules react without being imported. This is how `profile` evicts its cache when a village changes, although no module may import `profile`.

```ts
// domain/village-events.ts (export the type from the module's index.ts)
export const VILLAGE_PUBLISHED = 'village.published';
export type VillagePublished = DomainEvent<typeof VILLAGE_PUBLISHED, { slug: string }>;

// application/publish-village.use-case.ts
constructor(@Inject(DOMAIN_EVENT_PUBLISHER) private readonly events: DomainEventPublisher) {}

@Transactional()
async execute(...) {
  // ... write, audit
  await this.events.publish({ name: VILLAGE_PUBLISHED, occurredAt: now, aggregateId: village.id, payload: { slug } });
}

// another module, infrastructure/village-cache.listener.ts (a provider of that module)
@Injectable()
export class VillageCacheListener {
  @OnDomainEvent(VILLAGE_PUBLISHED)
  async evict(event: VillagePublished): Promise<void> { ... }
}
```

- **After commit only.** Inside a transaction, `publish` queues the event on the transaction. It is delivered after `COMMIT` and dropped on `ROLLBACK`, so a listener never reacts to a change that did not happen. Outside a transaction it is delivered at once.
- **Listeners cannot break the request.** They run in process, concurrently, and are awaited before the response is sent. A listener that throws is logged at `error` (`Domain event listener failed`, with the event name, the aggregate id and the request ID of the access log) and the response stays as it was.
- **Names:** `<module>.<pastTenseVerb>`. **Payload:** plain values a listener needs, no entities and no personal data beyond what it needs.
- Use `@OnDomainEvent`, not `@OnEvent`: the library's default would swallow the error with a less useful log line.
- A listener that writes uses its own `@Transactional()`; it runs after the first transaction is gone, so it starts a new one.

**Limitation:** events live in memory. If the process dies between `COMMIT` and delivery, or a listener fails, nothing retries it. That is acceptable for cache eviction and notifications. A transactional outbox (events stored in the same transaction, delivered by a worker) would remove the gap; it is out of scope for this project.

Tests: `test/domain-events.int-spec.ts`.

## Audit entries

Every write records what it changed through the `AuditRecorder` port, in the same use case and transaction as the change.

```ts
constructor(@Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder) {}

@Transactional()
async execute(input: RenameVillageInput) {
  const before = await this.villages.findById(input.id);
  const after = await this.villages.update(before.rename(input.name), input.expectedVersion);
  await this.audit.record({
    action: 'village.renamed',
    entityType: 'Village',
    entityId: after.id,
    villageId: after.id,          // optional: lets the audit API filter by village
    before: before.snapshot(),    // omitted on create
    after: after.snapshot(),      // omitted on delete
  });
}
```

The contract every implementation keeps (TSDoc on [`AuditRecorder`](../src/shared/kernel/audit/audit-recorder.ts)):

- **It writes in the caller's active transaction.** A failed audit insert rolls the change back, and a rolled-back change leaves no entry. Calling `record` outside `@Transactional()` throws.
- **It fills `actorId`, `requestId` and `occurredAt`** from the request context and the `Clock`. A use case never passes them. The auth guard (#10) sets the actor with `RequestContext.setActorId(userId)`; it does not need to import anything from `iam` for that.
- **Snapshots are allow-lists:** `snapshot()` on the aggregate returns the fields worth keeping, never the whole object, never password hashes or tokens.

Until the audit module lands, AppModule binds a placeholder (`AuditPlaceholderModule`, [`src/platform/audit`](../src/platform/audit)) that checks the transaction and logs each entry at `warn` with `audit persistence not implemented yet (#20)`. **#20 replaces it** with the audit module's implementation and deletes the placeholder.

In tests, bind [`InMemoryAuditRecorder`](../test/support/in-memory-audit-recorder.ts) (`.overrideProvider(AUDIT_RECORDER).useValue(audit)`). It records each entry with `inTransaction`, and `audit.failNext()` proves that a failed audit rolls the change back.

## Documenting an endpoint (Swagger)

Swagger UI is served at `/api/docs` and the document at `/api/docs-json` when `SWAGGER_ENABLED` allows it (on by default, off with `NODE_ENV=production`; [configuration.md](configuration.md#api)). Request and response schemas come from the zod schemas, so a controller needs only a few decorators:

```ts
@ApiModule('village') // tag "village"; operationIds village_<method>
@Controller('villages')
export class VillageController {
  @Patch(':id')
  @ETag()
  @ApiOperation({ summary: 'Rename a village' })
  @ApiOkResponse({ standardSchema: villageResponse })
  @ApiProblems(400, 404, 409, 412, 422, 428)
  update(@Param('id', { schema: idParam }) id: string, @IfMatch() version: number, @Body({ schema: updateVillageBody }) body: UpdateVillageBody) { ... }
}
```

| Convention       | Rule                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tags             | One per module, the module name: `@ApiModule('village')` on every controller.                                                                                                                        |
| `operationId`    | `<module>_<method>`, e.g. `village_create`, generated by `@ApiModule`. Method names must therefore be unique within a module (the reference e2e test checks the pattern and uniqueness).             |
| Request schemas  | The zod schemas on `@Body`/`@Query`/`@Param`; nothing to add.                                                                                                                                        |
| Response schemas | `@ApiOkResponse({ standardSchema })` / `@ApiCreatedResponse(...)`. Give response schemas an id (`.meta({ id: 'VillageResponse' })`) so they become reusable components. Lists: `pageResponse(item)`. |
| Errors           | `@ApiProblems(...)` with the statuses the endpoint can return; each points at the shared `ProblemDetails` component. 500 is implied.                                                                 |
| Auth             | The bearer scheme is defined once (`bearer`). Endpoints that need a token add `@ApiBearerAuth('bearer')` (from #10 on).                                                                              |
| `If-Match`       | `@IfMatch()` documents the header itself.                                                                                                                                                            |

The committed contract is [`docs/api/openapi.json`](api/openapi.json). After changing an endpoint, DTO or decorator, run `npm run openapi:generate` and commit the file: CI fails when it is out of date ([ci.md](ci.md#quality)), and the PR diff shows reviewers exactly how the API changed. Apidog (#59) and the web client (#61) read that file. The generator needs no database or Redis: it boots the app in Nest's preview mode, which builds the routes without creating any provider ([`src/generate-openapi.ts`](../src/generate-openapi.ts)).

## Current time and new IDs

Business code asks for time and ids through the kernel ports, so tests can fix both.

```ts
// application/create-village.use-case.ts
import { CLOCK, ID_GENERATOR, type Clock, type Id, type IdGenerator } from '../../../shared/kernel';

@Injectable()
export class CreateVillage {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  execute(input: CreateVillageBody) {
    const id: Id<'Village'> = this.ids.next<'Village'>(); // UUIDv7
    const createdAt = this.clock.now();
    // pass both into the domain: Village.create({ id, createdAt, ... })
  }
}

// in a unit test
const clock = new FixedClock('2026-10-15T08:00:00Z');
const useCase = new CreateVillage(clock, new SequentialIdGenerator());
```

`Id<'Village'>` is a string at runtime; the compiler stops it from being passed where an `Id<'PopulationRecord'>` is expected. Turn a database value or a validated path parameter into one with `asId<'Village'>(row.id)`.

**Don't:** `new Date()`, `Date.now()`, `randomUUID()` or `import { v7 } from 'uuid'` in `domain/` or `application/`. ESLint rejects all four there.

## Logging

pino writes one JSON line per log call (pretty-printed in `development`), and one access line per request with method, route, status, duration, `requestId` and, once #10 lands, `userId`. Every line written during a request carries its `requestId`, the same value as the `X-Request-Id` header and the `traceId` of an error response.

```ts
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class GeocodingClient {
  private readonly logger = new Logger(GeocodingClient.name);

  async lookup(name: string) {
    this.logger.log({ provider: 'nominatim', name }, 'geocoding lookup');
    // ...
    this.logger.warn(
      { provider: 'nominatim', status: res.status },
      'geocoding failed, using cache',
    );
  }
}
```

- Pass an object first and a short constant message second, so the fields are searchable.
- Keys named `password`, `token`, `accessToken`, `refreshToken`, `secret` (and anything ending in those) are replaced by `[REDACTED]` at any depth, as are the `authorization` and `cookie` headers.
- Request bodies are never logged outside `development`.
- Do not log errors you throw on purpose; the access line shows the status. Unexpected errors are logged once by the exception filter, with the stack.

**Don't:** `console.log`, or log a whole entity or request body: it may carry personal data under a key the redaction does not know.

## Build a new endpoint in 10 steps

[`test/reference-module`](../test/reference-module) is a complete small module (`Widget`: create, get, list, rename, delete) that uses every helper on this page. It is test-only: its table is created by the tests and AppModule does not import it, so it is neither in the migrations nor in the API. dependency-cruiser and ESLint check it like a real module. Each file starts with a comment saying what to copy. To add a write endpoint to your module:

1. **Entity and rule:** an aggregate with a private constructor, `create()` that enforces the invariants and takes `id` and `now` as arguments, `restore()` for rows, `snapshot()` for audit. → [`domain/widget.ts`](../test/reference-module/domain/widget.ts)
2. **Domain unit test:** every invariant, with `FixedClock` and `SequentialIdGenerator`. → [`domain/widget.spec.ts`](../test/reference-module/domain/widget.spec.ts)
3. **Repository port:** an interface and a token in `domain/`, in terms of aggregates. → [`domain/widget.repository.ts`](../test/reference-module/domain/widget.repository.ts)
4. **Table:** your module's `schema.ts` with `...versionColumns()` and the constraints, then `npm run db:generate` and review the SQL. → [`infrastructure/persistence/schema.ts`](../test/reference-module/infrastructure/persistence/schema.ts)
5. **Repository adapter:** the module handle, row↔aggregate mapping, the sort allow-list as columns, `updateWithVersion`/`softDeleteWithVersion`, native SQL through `sql`. → [`infrastructure/drizzle-widget.repository.ts`](../test/reference-module/infrastructure/drizzle-widget.repository.ts)
6. **Repository integration test** against PostGIS. → [`infrastructure/drizzle-widget.repository.int-spec.ts`](../test/reference-module/infrastructure/drizzle-widget.repository.int-spec.ts)
7. **Use case:** `@Transactional()`, `CLOCK`/`ID_GENERATOR`, the repository port, `AuditRecorder.record` on every write, a domain event if others care. → [`application/create-widget.use-case.ts`](../test/reference-module/application/create-widget.use-case.ts), [`update-widget.use-case.ts`](../test/reference-module/application/update-widget.use-case.ts)
8. **DTOs and mapper:** zod `strictObject` requests, `paginationQuery` + `sortQuery`, a response schema with an id, a mapper from the aggregate. → [`web/widget.schemas.ts`](../test/reference-module/web/widget.schemas.ts), [`web/widget.mapper.ts`](../test/reference-module/web/widget.mapper.ts)
9. **Controller and module file:** `@ApiModule`, `@ETag()`/`@IfMatch()`, `@ApiProblems`, one use case per handler; bind the port to the adapter in `<module>.module.ts`. → [`web/widget.controller.ts`](../test/reference-module/web/widget.controller.ts), [`widget.module.ts`](../test/reference-module/widget.module.ts)
10. **E2E test for every status the endpoint documents,** with `InMemoryAuditRecorder`; then `npm run openapi:generate` and commit `docs/api/openapi.json`. → [`widget.e2e-spec.ts`](../test/reference-module/widget.e2e-spec.ts)
