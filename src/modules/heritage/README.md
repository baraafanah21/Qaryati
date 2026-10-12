# heritage module

**Owner:** Ali · **Issues:** #17, #24, #31

## Responsibility

History overview, historical events, landmarks and cultural items of a village.

## Owned data

`history_overview`, `historical_event`, `landmark`, `cultural_item`. Tables are declared only in `infrastructure/persistence/schema.ts` of this module (from #3). No other module edits them.

## Public API (`index.ts`)

Empty for now. Planned:

- Read facade for heritage sections, used by profile (#39).
- Registers its claim types with curation through a `ClaimHandler`.

## Dependencies

| Direction                         | Modules                      |
| --------------------------------- | ---------------------------- |
| May import (besides `src/shared`) | `iam`, `curation`, `village` |
| Imported by                       | `profile`                    |

dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Layout

| Folder            | Holds                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| `web/`            | Controllers and request/response DTOs                                               |
| `application/`    | Use cases; the transaction boundary                                                 |
| `domain/`         | Entities, value objects, rules and repository ports; plain TypeScript, no framework |
| `infrastructure/` | Adapters: Drizzle repositories and schema, Redis, HTTP clients                      |
