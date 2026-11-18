# audit module

**Owner:** Yahya · **Issues:** #20, #44

## Responsibility

Append-only audit trail of every write, recorded in the same transaction as the change, and (from #44) the audit read APIs.

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

`entity_id`, `village_id` and `actor_id` are not foreign keys. The trail must outlive the rows it describes: when an admin hard-deletes spam (`deleteWithVersion`), the entries about it stay. A foreign key would either block that delete or cascade it into the history. It also keeps `audit` independent: it imports no other module. See [docs/database.md](../../../docs/database.md#audit-trail-20).

## Snapshot allow-list

[`domain/snapshot-policy.ts`](domain/snapshot-policy.ts) maps each entity type to the fields the trail keeps. `before` and `after` keep only those fields. On top of that, any key matching `/password|token|secret|hash/i` is always dropped (defence in depth), except `valueHash` / `value_hash` on `Claim`, which is a digest of the claim's value and not a secret.

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

## What #44 adds

Read APIs for admins: entries of one entity, of one village, of one actor, and the unfiltered list, newest first with keyset pagination on `(occurred_at, id)`. The four indexes in `schema.ts` exist for exactly those queries.

## Dependencies

| Direction                         | Modules |
| --------------------------------- | ------- |
| May import (besides `src/shared`) | none    |
| Imported by                       | none    |

dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Layout

| Folder            | Holds                                                          |
| ----------------- | -------------------------------------------------------------- |
| `domain/`         | `snapshot-policy.ts`: the allow-list; plain TypeScript         |
| `infrastructure/` | `DrizzleAuditRecorder`, `persistence/schema.ts`, `audit-db.ts` |
| `application/`    | Empty until #44's read use cases                               |
| `web/`            | Empty until #44's controllers                                  |
