# geo module

**Owner:** Ali · **Issues:** #21, #37, #41

## Responsibility

Geocoding through an external API (Nominatim) behind a port: resilience, cache, the suggestion queue and the accept flow that updates a village location.

## Owned data

Geocoding suggestions. Tables are declared only in `infrastructure/persistence/schema.ts` of this module (from #3). No other module edits them.

## Public API (`index.ts`)

Empty for now. Planned:

- Nothing planned for other modules yet.

## Dependencies

| Direction                         | Modules                      |
| --------------------------------- | ---------------------------- |
| May import (besides `src/shared`) | `iam`, `curation`, `village` |
| Imported by                       | none                         |

dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Layout

| Folder            | Holds                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| `web/`            | Controllers and request/response DTOs                                               |
| `application/`    | Use cases; the transaction boundary                                                 |
| `domain/`         | Entities, value objects, rules and repository ports; plain TypeScript, no framework |
| `infrastructure/` | Adapters: Drizzle repositories and schema, Redis, HTTP clients                      |
