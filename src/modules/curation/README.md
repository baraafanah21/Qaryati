# Curation module

**Owner:** Yahya · **Issues:** #13, #16, #35, #40

## Responsibility

Curation manages information provenance and verification. Issue #13 implements source management only: creation, retrieval, searching, updating, access control, optimistic locking, and audit recording.

Issue #16 adds the shared claim schema, claim domain rules, ClaimWriter facade, and provenance helpers. Issue #35 adds the review endpoints (verify, dispute, reject, prefer) and the `ClaimTypeRegistry` projection hook; issue #40 adds the review queue and the computed conflicts list.

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

Other modules access curation through `index.ts`. `CurationModule` is global, so they inject these facades without importing its wiring. It exports:

- `SourceQueries`, including `exists(id): Promise<boolean>`
- `ClaimQueries.hasPreferredForGroup(groupKey): Promise<boolean>`: whether a question already has a published (preferred) claim. The owning module builds the key with `buildGroupKey`; village uses it to lock a display name once its `CURRENT` name claim is published (#23). It reads the partial unique index `claim_one_preferred`.
- `SOURCE_TYPES`
- `SourceType`
- `ClaimTypeRegistry` and the `ClaimTypeHandler` / `PreferredClaimChange` types (#35): owning modules register their claim types and projection hook (see "Claim review" below).

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

## Claims foundation (#16)

Issue #16 introduces the shared `claim` table and the `ClaimWriter` application facade.

A claim represents provenance and review metadata for a typed village fact. Fact-specific tables remain owned by their respective modules.

### Claim types

Supported claim types:

- `VILLAGE_NAME`
- `NAME_ORIGIN`
- `AFFILIATION`
- `LOCATION`
- `MEASURE`
- `RELATION`
- `POPULATION`
- `HISTORY_OVERVIEW`
- `HISTORICAL_EVENT`
- `LANDMARK`
- `CULTURAL_ITEM`
- `VILLAGE_PRODUCT`
- `FACILITY`

Claim statuses:

- `UNVERIFIED`
- `VERIFIED`
- `DISPUTED`
- `REJECTED`
- `WITHDRAWN`

### Claim submission

Other fact modules use `ClaimWriter` through the public curation API.

`submit()` creates a claim in `UNVERIFIED` status, with `isPreferred = false`.

The caller is responsible for validating village existence before submission.

When `sourceId` is provided, it must reference an existing source. `POPULATION` claims require a source on submission.

If `supersedesId` is provided, it must reference an existing claim from the same village and claim type.

### Editing and withdrawal

Only the original author may edit or withdraw an `UNVERIFIED` claim.

Edits use optimistic locking through the expected version. A stale version results in a precondition failure.

### Review rules

Allowed status transitions:

- `UNVERIFIED` -> `VERIFIED`, `REJECTED`, `DISPUTED`, `WITHDRAWN`
- `DISPUTED` -> `VERIFIED`, `REJECTED`
- `VERIFIED` -> `DISPUTED`
- `REJECTED` and `WITHDRAWN` are terminal.

A claim author cannot review their own claim.

Verification requires a source. Rejection and dispute require a review note.

The review endpoints and preferred-claim selection are described in "Claim review (#35)" below.

### Group keys and value hashing

`buildGroupKey()` constructs stable keys using the claim type's prefix, village ID, and optional grouping parts.

Group-key parts must be non-empty and must not contain the `|` separator.

`valueHash()` generates a deterministic SHA-256 hash of a canonical claim value.

Canonicalization sorts object keys, preserves JSON value types, normalizes negative zero, and rejects non-finite numeric values.

`roundCoordinate()` rounds coordinates to five decimal places.

### Database constraints

The `claim` table includes:

- Primary key on `id`.
- Unique constraint on `(id, claim_type)`.
- Foreign keys to `source`, `claim`, `village`, and `user_account`.
- CHECK constraints requiring preferred claims to be verified and verified claims to have a source.
- Partial unique index `claim_one_preferred`.
- Partial unique index `claim_no_duplicate` using `NULLS NOT DISTINCT`.
- Review queue, village publication, grouping, and foreign-key indexes.

The cross-module foreign keys and duplicate-prevention index are defined in custom migration `0009_claim_cross_module_fks.sql`.

Claims use versioning and timestamps and do not have a `deleted_at` column.

### Transactions and audit

`ClaimWriter` uses `@Transactional()` for submission, editing, and withdrawal.

Audit actions:

- `claim.submitted`
- `claim.edited`
- `claim.withdrawn`

Successful writes record audit entries. Edits and withdrawals include before-and-after snapshots.

### Scope limitations

Issue #16 does not introduce HTTP endpoints or fact-specific tables; #35 and #40 add the review and queue endpoints below.

Fact modules must import the public curation API instead of importing curation persistence internals.

## How to add a fact type in your module

1. Check `docs/data-model.md` for the fact type, its fields, and its claim type.
2. Import `ClaimWriter`, `buildGroupKey`, and `valueHash` from the public curation `index.ts`.
3. Define the fact-specific table in your own module's persistence schema. Keep provenance and review metadata in the shared `claim` table.
4. Add `claim_id` and a constant `claim_type` to the fact table. Create a composite foreign key `(claim_id, claim_type)` referencing `claim(id, claim_type)` with `ON DELETE CASCADE` in a custom SQL migration.
5. Build the group key using the correct claim type, village ID, and grouping parts. Hash the canonical fact value with `valueHash()`. Use `roundCoordinate()` for location coordinates before hashing.
6. Validate the village and fact-specific data in your module. Validate the source if required.
7. Inside one `@Transactional()` use case, call `ClaimWriter.submit()` and insert the fact-specific row. Both writes must commit or roll back together.
8. For an author correction to an unverified claim, call `ClaimWriter.edit()` with the expected version. Use `withdraw()` when the author withdraws an unverified claim. Reviewed corrections require a new claim rather than editing the reviewed one.
9. Add unit tests for group keys and fact validation, plus integration tests for the composite foreign key, cascade behavior, and transaction rollback.
10. Do not import curation's internal schema or repository. Review endpoints are shared (#35): do not add your own verify or prefer endpoints.
11. If your module keeps a projection of the preferred claim (village: `display_name_ar/en`, `location`), register a `ClaimTypeHandler` with `onPreferredChanged` in your module's `onModuleInit` (see "Claim review" below).

## Claim review (#35)

All endpoints need the `EDITOR` role (or `ADMIN`) and return the claim with its version `ETag`. Every action needs `If-Match` with the claim's current version (428 without it, 412 when stale) and takes an optional strict body `{ "note": "..." }` (at most 2000 characters).

| Method | Endpoint                      | Effect                                                                                                                   |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/claims/{id}`         | The claim's common fields and review state                                                                               |
| POST   | `/api/v1/claims/{id}/verify`  | `VERIFIED`; needs a source (422). If the question has no preferred claim, this one becomes preferred                     |
| POST   | `/api/v1/claims/{id}/dispute` | `DISPUTED`; needs a note (422). A preferred claim loses the flag                                                         |
| POST   | `/api/v1/claims/{id}/reject`  | `REJECTED`; needs a note (422)                                                                                           |
| POST   | `/api/v1/claims/{id}/prefer`  | Only a `VERIFIED` claim (422): the old preferred claim of the question loses the flag, this one gets it, one transaction |

- **Four eyes:** the author cannot verify, dispute or reject their own claim: 403 `SELF_VERIFICATION_FORBIDDEN`. Prefer has no four-eyes rule: the claim was already verified by someone else.
- **Transitions** are the ones listed under "Review rules"; a preferred claim is `VERIFIED`, which can only move to `DISPUTED`, so "unpublish" is a dispute. Rejecting needs a dispute first.
- **Preferring the claim that is already preferred** changes nothing: 200, same version, no audit entry, no hook call.
- **Where the logic lives:** `Claim.review` (status rules), `decidePreference` in `domain/claim-preference.ts` (a pure function: how the flag moves), and `ReviewClaim` (one `@Transactional()` use case that reads, writes the old flag first, then the new one, then calls the hook, then audits).
- **Audit:** one entry per action, `claim.verified`, `claim.disputed`, `claim.rejected`, `claim.preferred`, with `villageId`, before and after snapshots. When the flag moves, `after.previousPreferredClaimId` names the claim that lost it; a prefer note is kept as `after.preferenceNote` (the claim's `reviewNote` stays the verifier's note).

### Concurrency

Two editors preferring different claims of the same question at once: exactly one wins, the other gets **409 `VERSION_CONFLICT`**. The old preferred claim is cleared with the version read in the same request, so the second writer's update finds a changed version; when there was no preferred claim, the partial unique index `claim_one_preferred` rejects the second flag (SQLSTATE 23505), which the repository maps to the same 409. No row lock is held across the request. Two concurrent first verifications of one question behave the same way; the loser retries and is verified without the flag.

### Projection hook: `ClaimTypeRegistry`

```ts
@Module({/* ... */})
export class VillageModule implements OnModuleInit {
  constructor(
    private readonly claimTypes: ClaimTypeRegistry,
    private readonly projector: VillageProjector,
  ) {}

  onModuleInit(): void {
    this.claimTypes.register({
      claimType: 'LOCATION',
      onPreferredChanged: (change) => this.projector.locationChanged(change),
    });
  }
}
```

- `change` is `{ villageId, groupKey, newPreferredClaimId, previousPreferredClaimId }`. `newPreferredClaimId` is `null` when the preferred claim was disputed: the owner decides the fallback (for example keep the projection, or clear it).
- The hook runs **inside the review transaction**. If it throws, the status change, the flag and the audit entry roll back together, so a projection never disagrees with its preferred claim.
- One handler per claim type; registering a second one throws at start-up. A type without a handler simply has no projection.
- Curation never imports the owners; they import `ClaimTypeRegistry` from curation's `index.ts`. No handler is registered yet; the village handler comes with the village fact tables.

## Review queue and conflicts (#40)

Both endpoints need the `EDITOR` role and use `page` and `size` (offset pagination, `Page<T>`). Both are native SQL in `DrizzleClaimRepository`.

| Method | Endpoint                     | Query                                                                 |
| ------ | ---------------------------- | --------------------------------------------------------------------- |
| GET    | `/api/v1/curation/queue`     | `status=UNVERIFIED` (default) or `DISPUTED`, `claimType`, `villageId` |
| GET    | `/api/v1/curation/conflicts` | `claimType`, `villageId`                                              |

- **Queue:** claims of one status, oldest first (`ORDER BY created_at, id`). The query repeats the predicate of the partial index `claim_review_queue (status, created_at)`, and an integration test checks with `EXPLAIN` that it is used.
- **Conflicts:** the "Conflicts are computed, never stored" query of `docs/data-model.md`: questions whose live claims (`UNVERIFIED`, `VERIFIED`, `DISPUTED`) have more than one distinct `value_hash`. Each item has `groupKey`, `villageId`, `claimType`, `distinctValues`, `claimCount` and `claimIds` (oldest first). Two sources giving the same value are agreement, not a conflict.

### Decision: conflicts are not marked `DISPUTED` automatically

Issue #40 first asked to mark conflicting population records `DISPUTED` automatically. That is not done:

- one wrong entry would silently dispute a verified, published fact and unpublish it;
- it contradicts "conflicts are computed, never stored" (ADR-003): a stored mark goes stale as soon as a claim is withdrawn or rejected.

Instead the conflicts list is the editors' inbox. **Resolving a conflict** = verify or prefer the right claim, and reject or dispute the others; reject and dispute require a note, so every resolution is explained and audited.
