# audit module

**Owner:** Yahya · **Issues:** #20, #44

## Responsibility

Append-only audit trail of every write, recorded in the same transaction as the change, and the audit read APIs (#44).

## What is recorded

Every write use case calls `AuditRecorder.record(...)` (token `AUDIT_RECORDER`, port in `src/shared/kernel/audit`) inside its `@Transactional()` method. `DrizzleAuditRecorder` stores one row in `audit_entry`:

| Column                     | Filled by                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `id`                       | `IdGenerator` (UUIDv7)                                                             |
| `action`                   | the use case, `<entity>.<pastTenseVerb>` (e.g. `source.created`)                   |
| `entity_type`, `entity_id` | the use case; `entity_id` is text because some ids are codes or family ids         |
| `village_id`               | the use case, when the change belongs to a village                                 |
| `actor_id`                 | `RequestContext`; null for anonymous requests (registration) and system actions    |
| `request_id`               | `RequestContext`, the same value as the `X-Request-Id` header                      |
| `occurred_at`              | `Clock`                                                                            |
| `before`, `after`          | the use case's `snapshot()`, filtered through the allow-list below; null if absent |

The port's contract is in [docs/kernel.md](../../../docs/kernel.md#audit-entries). The handle joins the caller's transaction, so a failed audit insert rolls the change back and a rolled-back change leaves no entry. Calling `record` outside `@Transactional()` throws.

## Append-only, and why

An audit trail that the API can edit proves nothing. The table has no version columns and no `updated_at`, and the migration `0011_audit_entry_append_only` revokes `UPDATE`, `DELETE` and `TRUNCATE` from `qaryati_app`. The API can only `INSERT` and `SELECT`. Correcting the trail is an owner-role operation outside the app.

## No foreign keys, and why

`entity_id`, `village_id` and `actor_id` are not foreign keys. The trail must outlive the rows it describes: when an admin hard-deletes spam (`deleteWithVersion`), the entries about it stay. A foreign key would either block that delete or cascade it into the history. It also keeps `audit` independent of the modules it records: it imports only `iam`, for role decorators. See [docs/database.md](../../../docs/database.md#audit-trail-20).

## Snapshot allow-list

[`domain/snapshot-policy.ts`](domain/snapshot-policy.ts) maps each entity type to the fields the trail keeps. `before` and `after` keep only those fields. On top of that, any key matching `/password|token|secret|hash/i` is always dropped (defence in depth), except `valueHash` / `value_hash` on `Claim`, which is a digest of the claim's value and not a secret. `Claim` also keeps `fact`: the owning module's fact value before and after an author's edit (for example a village name), which the claim itself stores only as a hash.

**No personal data.** The trail is never deleted from, so snapshots keep no personal data such as a user's email; `entity_id` already identifies the user. `UserAccount` keeps only `role` and `status`.

Entity types today: `AdminUnit`, `Claim`, `RefreshToken`, `Source`, `UserAccount`, `Village`. The reference module's `Widget` is added only in tests (`AUDIT_SNAPSHOT_POLICY` is a provider, so a test can extend it).

**Adding an entity type:** in the PR that adds its first audited write, add a line to `SNAPSHOT_POLICY` with the fields worth keeping (never credentials or large blobs), update the list in `snapshot-policy.spec.ts`, and keep the aggregate's own `snapshot()` an allow-list too.

### Trade-off: an unknown entity type throws

`record` throws for an entity type with no entry, naming the type and this file, and the change rolls back. A silent fallback (store nothing, or store everything) would either lose history or leak fields. Every write path has a test, so a missing entry fails a test long before production. The cost is that forgetting the entry breaks the write instead of degrading it.

## Owned data

`audit_entry`, declared in `infrastructure/persistence/schema.ts` (picked up by `drizzle.config.ts`). No other module edits it.

## Public API (`index.ts`)

Empty. Audit implements the `AuditRecorder` port and `AuditModule` (`@Global()`) provides `AUDIT_RECORDER`. **No module imports audit**; only AppModule imports `AuditModule`.

In tests, bind [`InMemoryAuditRecorder`](../../../test/support/in-memory-audit-recorder.ts) with `.overrideProvider(AUDIT_RECORDER)` when a test asserts on entries without the database; otherwise the real recorder runs.

## Read APIs (#44)

| Endpoint                                                                            | Who     | What                                                                             |
| ----------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| `GET /api/v1/villages/{id}/history-log?cursor=&limit=`                              | EDITOR+ | the entries of one village                                                       |
| `GET /api/v1/audit?actorId=&entityType=&entityId=&action=&from=&to=&cursor=&limit=` | ADMIN   | the whole trail; every given filter must match; `from` inclusive, `to` exclusive |

Both answer `{ content: AuditEntry[], nextCursor: string | null }`, newest first.

**Keyset pagination on `(occurred_at, id)`.** A page is `WHERE <filters> AND (occurred_at, id) < (cursor) ORDER BY occurred_at DESC, id DESC LIMIT limit + 1`; the extra row tells whether a next page exists, so there is no count query. The four indexes of #20 (`audit_entry_village_idx`, `_actor_idx`, `_entity_idx`, `_occurred_idx`, all ending in `occurred_at DESC, id DESC`) serve exactly these reads: the planner walks the index from the cursor, so page 1000 costs what page 1 does, unlike `OFFSET`. `id` breaks ties between entries recorded at the same instant, so none is skipped or repeated (`test/audit/audit-log.int-spec.ts` pages 23 entries on three instants). The trail is append-only and grows fast, which is why it uses a keyset while the other lists use page numbers.

**The cursor** (`domain/audit-cursor.ts`) is base64url of `[occurredAt ISO, id]`: opaque, so clients only pass back `nextCursor`. It is not signed: it only says where to start reading, and any value it can hold is a valid start. A cursor this API did not issue is a 400. `occurred_at` comes from the `Clock` with millisecond precision, the precision of the cursor.

**Snapshots on read.** `before` and `after` are filtered through the allow-list again (`readableSnapshot`): narrowing an entry of `SNAPSHOT_POLICY` also hides what older entries kept, and an entity type removed from the policy shows `null` instead of failing the read.

**No 404 for an unknown village.** `history-log` of an unknown id is an empty page: the trail outlives the rows it describes, so the history of a hard-deleted village stays readable, and audit imports no `village` facade to check it.

**Roles.** The controllers use `@Roles()` from `iam`'s `index.ts`; `audit → iam` is the only module import audit has.

## Dependencies

| Direction                         | Modules                                  |
| --------------------------------- | ---------------------------------------- |
| May import (besides `src/shared`) | `iam` (role decorators of the read APIs) |
| Imported by                       | none                                     |

dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Layout

| Folder            | Holds                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `domain/`         | `snapshot-policy.ts` (the allow-list), `audit-cursor.ts`, `audit-log.ts` (read port); plain TS |
| `infrastructure/` | `DrizzleAuditRecorder`, `DrizzleAuditLogReader`, `persistence/schema.ts`, `audit-db.ts`        |
| `application/`    | `ListAuditEntries`: both read APIs                                                             |
| `web/`            | `AuditController` and its zod schemas                                                          |
