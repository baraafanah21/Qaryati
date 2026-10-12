# profile module

**Owner:** Momen · **Issues:** #39, #45

## Responsibility

Read-only composition of one village: the details page `GET /villages/{idOrSlug}`, `GET /villages/{id}/completeness`, and the details cache.

## Owned data

No tables. Redis cache entries for village details (#45). It has no `schema.ts`.

## Public API (`index.ts`)

Empty for now. Planned:

- Nothing. **No module imports profile.**

## Dependencies

| Direction                         | Modules                                                           |
| --------------------------------- | ----------------------------------------------------------------- |
| May import (besides `src/shared`) | `iam`, `curation`, `village`, `population`, `heritage`, `economy` |
| Imported by                       | none                                                              |

dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Layout

| Folder            | Holds                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| `web/`            | Controllers and request/response DTOs                                               |
| `application/`    | Use cases; the transaction boundary                                                 |
| `domain/`         | Entities, value objects, rules and repository ports; plain TypeScript, no framework |
| `infrastructure/` | Adapters: Drizzle repositories and schema, Redis, HTTP clients                      |
