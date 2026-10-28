# curation module

**Owner:** Yahya · **Issues:** #13, #16, #35, #40

## Responsibility

Provenance and verification: sources, the claim columns and `ClaimPolicy`, the verification workflow (verify, dispute, reject, prefer), conflict detection and the curation queue.

Issue #13 implements source management, including creation, retrieval, searching, updating, access control, optimistic concurrency and audit recording.

## Owned data

`source`, plus the claim column helper that content tables reuse (#16).

Tables are declared only in `infrastructure/persistence/schema.ts` of this module, which `drizzle.config.ts` picks up. No other module edits them. See [docs/database.md](../../../docs/database.md).

The `source` table stores bibliographic metadata, source type, reliability, ownership, timestamps, version and soft-deletion state.

Supported source types:

- `BOOK`
- `ARTICLE`
- `CENSUS`
- `GOV_DATASET`
- `ARCHIVE`
- `ORAL_HISTORY`
- `WEBSITE`
- `EXTERNAL_API`

The database enforces source constraints and partial uniqueness for non-deleted URLs and ISBNs. A trigram index supports title searches.

## Public API (`index.ts`)

Implemented in Issue #13:

- `SourceQueries.exists(id): Promise<boolean>` — returns whether a non-deleted source exists.

Planned for future issues:

- The `ClaimHandler` registry (#35): content modules register a handler for their claim types, so curation never imports them.

Other modules must access curation functionality through `index.ts`, not through internal repository or application files.

## Sources REST API (#13)

All endpoints require authentication and at least the `CONTRIBUTOR` role.

| Method | Endpoint              | Description                     |
| ------ | --------------------- | ------------------------------- |
| POST   | `/api/v1/sources`     | Create a source                 |
| GET    | `/api/v1/sources`     | List, search and filter sources |
| GET    | `/api/v1/sources/:id` | Retrieve a source               |
| PATCH  | `/api/v1/sources/:id` | Update an existing source       |

### Create source

`POST /api/v1/sources`

Accepts source metadata including type, title, author, publisher, publication year, URL, ISBN, reliability and notes.

The authenticated user is recorded as the creator and last updater.

Creation returns HTTP `201` with the created source and an ETag representing its version.

### List and search sources

`GET /api/v1/sources`

Supported query parameters:

| Parameter | Description              |
| --------- | ------------------------ |
| `q`       | Search source titles     |
| `type`    | Filter by source type    |
| `page`    | Page number              |
| `size`    | Page size, maximum 100   |
| `sort`    | Sort by an allowed field |

Allowed sorting fields are:

- `title`
- `publishedYear`
- `reliability`
- `createdAt`

Deleted sources are excluded from normal queries.

### Retrieve source

`GET /api/v1/sources/:id`

Returns the source with its current version and ETag.

Unknown or deleted sources return HTTP `404`.

### Update source

`PATCH /api/v1/sources/:id`

Supports partial updates.

A source may be updated by its creator or by a user with the `EDITOR` or `ADMIN` role.

The request must include an `If-Match` header containing the expected version.

- `403 Forbidden`: the user is not permitted to edit the source.
- `404 Not Found`: the source does not exist or is deleted.
- `412 Precondition Failed`: the submitted version is stale.
- `428 Precondition Required`: the `If-Match` header is missing.

Successful updates advance the source version and return an updated ETag.

## Domain validation

The source domain enforces business rules including:

- Title must contain 1–300 non-whitespace characters.
- Reliability must be an integer from 1 to 5.
- Publication year must be valid and cannot be in the future.
- URLs must use HTTP or HTTPS.
- ISBN-10 and ISBN-13 checksums must be valid.
- Notes must not exceed 2,000 characters.

ISBN values are normalized by removing hyphens before storage.

## Transactions and auditing

Create and update operations run inside database transactions.

They call the shared `AUDIT_RECORDER` port with the following actions:

- `source.created`
- `source.updated`

Update operations supply before-and-after snapshots.

Until Issue #20 provides persistent audit storage, `PlaceholderAuditRecorder` validates the transaction requirement and logs audit metadata as warnings. It does not persist audit records.

The curation module does not implement its own audit storage.

## Dependencies

| Direction                         | Modules                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| May import (besides `src/shared`) | `iam`                                                            |
| Imported by                       | `village`, `population`, `heritage`, `economy`, `geo`, `profile` |

Dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Layout

| Folder            | Holds                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| `web/`            | Controllers and request/response DTOs                                               |
| `application/`    | Use cases; the transaction boundary                                                 |
| `domain/`         | Entities, value objects, rules and repository ports; plain TypeScript, no framework |
| `infrastructure/` | Adapters: Drizzle repositories and schema, Redis, HTTP clients                      |

## Tests

Issue #13 includes domain unit tests, repository integration tests and tests for the public source-query service.

Relevant commands:

```bash
npm run test:unit -- --runInBand
npm run test:int -- --runInBand
npm run test:e2e -- --runInBand
npm run typecheck
npm run lint
npm run depcruise
```

HTTP E2E coverage specific to sources should verify creation, retrieval, filtering, role-based permissions, version conflicts and validation errors before the issue is considered complete.
