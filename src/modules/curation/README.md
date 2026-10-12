# curation module

**Owner:** Yahya · **Issues:** #13, #16, #35, #40

## Responsibility

Provenance and verification: sources, the claim columns and `ClaimPolicy`, the verification workflow (verify, dispute, reject, prefer), conflict detection and the curation queue.

## Owned data

`source`, plus the claim column helper that content tables reuse (#16). Tables are declared only in `infrastructure/persistence/schema.ts` of this module, which `drizzle.config.ts` picks up. No other module edits them. See [docs/database.md](../../../docs/database.md).

## Public API (`index.ts`)

Empty for now. Planned:

- `SourceQueries.exists(id)` (#13).
- The `ClaimHandler` registry (#35): content modules register a handler for their claim types, so curation never imports them.

## Dependencies

| Direction                         | Modules                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| May import (besides `src/shared`) | `iam`                                                            |
| Imported by                       | `village`, `population`, `heritage`, `economy`, `geo`, `profile` |

dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Layout

| Folder            | Holds                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| `web/`            | Controllers and request/response DTOs                                               |
| `application/`    | Use cases; the transaction boundary                                                 |
| `domain/`         | Entities, value objects, rules and repository ports; plain TypeScript, no framework |
| `infrastructure/` | Adapters: Drizzle repositories and schema, Redis, HTTP clients                      |
