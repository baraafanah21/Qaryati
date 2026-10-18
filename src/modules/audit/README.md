# audit module

**Owner:** Yahya · **Issues:** #20, #44

## Responsibility

Append-only audit trail of every write, recorded in the same transaction as the change, and the audit read APIs.

## Owned data

`audit_entry` (the runtime role may only INSERT and SELECT it). Tables are declared only in `infrastructure/persistence/schema.ts` of this module, which `drizzle.config.ts` picks up. No other module edits them. See [docs/database.md](../../../docs/database.md).

## Public API (`index.ts`)

Empty for now. Planned:

- Nothing for other modules. Audit implements the `AuditRecorder` port declared in `src/shared/kernel/audit` and provides it globally as `AUDIT_RECORDER`. **No module imports audit.**
- The port's contract (write in the caller's transaction; fill `actorId`, `requestId`, `occurredAt` from `RequestContext` and the `Clock`) is in [docs/kernel.md](../../../docs/kernel.md#audit-entries). Until #20 lands, `AuditPlaceholderModule` (`src/platform/audit`) binds a logging placeholder; #20 removes it from AppModule and deletes that folder.

## Dependencies

| Direction                         | Modules |
| --------------------------------- | ------- |
| May import (besides `src/shared`) | none    |
| Imported by                       | none    |

dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Layout

| Folder            | Holds                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| `web/`            | Controllers and request/response DTOs                                               |
| `application/`    | Use cases; the transaction boundary                                                 |
| `domain/`         | Entities, value objects, rules and repository ports; plain TypeScript, no framework |
| `infrastructure/` | Adapters: Drizzle repositories and schema, Redis, HTTP clients                      |
