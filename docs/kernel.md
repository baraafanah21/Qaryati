# Kernel usage guide

How to do the everyday things in an endpoint: one way each, copy and adapt. The pieces live here:

| Where                                                | What                                                                                     | Who may import it                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------- |
| [`src/shared/kernel`](../src/shared/kernel/index.ts) | Plain TypeScript: errors and codes, `Clock`, `Id`/`IdGenerator`, `Page<T>` and helpers   | every layer, **including `domain/`**  |
| [`src/platform/http`](../src/platform/http)          | Nest pieces: problem filter, validation pipe, `paginationQuery`, `sortQuery`, request ID | `web/` (controllers)                  |
| [`src/platform/database`](../src/platform/database)  | `DatabaseModule.forFeature`, `@InjectModuleDb()`, `ModuleDb<S>`                          | the module file and `infrastructure/` |
| [`src/platform/logging`](../src/platform/logging)    | pino setup (nothing to import day to day)                                                | AppModule only                        |

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

Request schemas are zod schemas, passed to the parameter decorator. The global pipe validates, converts types and answers 400 `VALIDATION_FAILED` with `errors[]`. Swagger (#9 part 2) reads the same schema, so the docs never drift from the validation.

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

**Don't:** create your own `Pool` or call `drizzle()` in a module. Every module shares the one pool, and part 2 of #9 runs transactions on it.

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
