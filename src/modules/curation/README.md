# Curation module

**Owner:** Yahya · **Issues:** #13, #16, #35, #40

## Responsibility

Curation manages information provenance and verification. Issue #13 implements source management only: creation, retrieval, searching, updating, access control, optimistic locking, and audit recording.

Claims, verification workflows, conflict detection, and the curation queue belong to later issues.

## Owned data

Issue #13 owns the `source` table, declared in `infrastructure/persistence/schema.ts`.

Each source stores bibliographic metadata, reliability, creator identity, version, and timestamps.

Supported source types:

- `BOOK`
- `ARTICLE`
- `CENSUS`
- `GOV_DATASET`
- `ARCHIVE`
- `ORAL_HISTORY`
- `WEBSITE`
- `EXTERNAL_API`

The database enforces primary-key, NOT NULL, URL and ISBN uniqueness, and the creator foreign key. Business validation belongs to the domain.

Indexes support source type, creator lookup, and trigram title searches.

There is no soft deletion, `deleted_at`, or `updated_by` column.

The `created_by` column references `user_account(id)` with `ON DELETE RESTRICT`, defined in the custom migration `0007_source_cross_module_fks.sql`.

## Public API

Other modules access curation through `index.ts`, which exports:

- `SourceQueries`, including `exists(id): Promise<boolean>`
- `SOURCE_TYPES`
- `SourceType`

The `exists` query checks whether a source record exists.

Other modules must not import curation's internal repositories or database schema.

## Sources REST API (#13)

All endpoints require authentication and at least the `CONTRIBUTOR` role. Higher roles inherit this permission.

| Method | Endpoint              | Description                      |
| ------ | --------------------- | -------------------------------- |
| POST   | `/api/v1/sources`     | Create a source                  |
| GET    | `/api/v1/sources`     | List, search, and filter sources |
| GET    | `/api/v1/sources/:id` | Retrieve a source                |
| PATCH  | `/api/v1/sources/:id` | Update a source                  |

### Create

`POST /api/v1/sources`

Accepts source metadata, validates it, and assigns the authenticated user's ID to `createdBy`.

Returns `201 Created` with the source representation, version ETag, and a `Location` header pointing to `/api/v1/sources/{id}`.

Clients cannot supply `id`, `createdBy`, `version`, or timestamps.

### List and search

`GET /api/v1/sources`

Supported query parameters:

| Parameter | Description              |
| --------- | ------------------------ |
| `q`       | Search source titles     |
| `type`    | Filter by source type    |
| `page`    | Page number              |
| `size`    | Page size                |
| `sort`    | Sort by an allowed field |

Allowed sort fields are `title`, `publishedYear`, `reliability`, and `createdAt`.

### Retrieve

`GET /api/v1/sources/:id`

Returns the requested source and its version ETag. Unknown sources return `404 Not Found`.

### Update

`PATCH /api/v1/sources/:id`

Only the creator, an `EDITOR`, or an `ADMIN` may update a source.

PATCH accepts a strict set of editable fields and requires an `If-Match` version header.

- `403 Forbidden`: insufficient permission
- `404 Not Found`: unknown source
- `412 Precondition Failed`: stale version
- `428 Precondition Required`: missing `If-Match`

Successful updates increment the version and return the updated ETag.

## Domain validation

The domain validates and normalizes source metadata:

- Title: trimmed, 1–300 characters.
- Author and publisher: optional, maximum 200 characters each.
- Publication year: between 1000 and the current year supplied through `Clock`.
- URL: optional, trimmed, HTTP or HTTPS, maximum 2048 characters.
- ISBN: optional, normalized by removing spaces and hyphens and uppercasing the final `X`; ISBN-10 and ISBN-13 checksums are validated.
- Reliability: integer from 1 to 5.
- Notes: optional, maximum 2000 characters.

Allowed source types are defined in `domain/source-values.ts`.

Business rules are not implemented with database CHECK constraints.

## Transactions and auditing

Create and update use `@Transactional()` and the shared `AUDIT_RECORDER` port.

Actions:

- `source.created`
- `source.updated`

Each successful write records one audit entry. Updates include before-and-after source snapshots.

Persistent audit storage is outside Issue #13.

## Dependencies

Curation may depend on IAM and the shared kernel. Other modules use the public `index.ts` entry point.

## Tests

Issue #13 includes domain unit tests, database integration tests, and authenticated HTTP E2E tests.

Relevant checks:

```bash
npm run test:unit
npm run test:int
npm run test:e2e
npm run lint
npm run typecheck
npm run depcruise
npm run db:check
npm run openapi:generate
```

The full repository formatting check may require normalizing existing Windows CRLF line endings before it passes locally.
