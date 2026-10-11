# audit module

**Owner:** Yahya · **Issues:** #20, #44

## Responsibility

Append-only audit trail of every write, recorded in the same transaction as the change, and the audit read APIs.

## Owned data

`audit_entry` (the runtime role may only INSERT and SELECT it). Tables are declared only in `infrastructure/persistence/schema.ts` of this module (from #3). No other module edits them.

## Public API (`index.ts`)

Empty for now. Planned:

- Nothing for other modules. Audit implements the `AuditRecorder` port declared in `src/shared` and provides it through Nest DI. **No module imports audit.**

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
