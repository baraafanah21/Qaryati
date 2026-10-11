# village module

**Owner:** Momen · **Issues:** #12, #15, #19, #23, #27, #30, #34, #39

## Responsibility

The core village record: identity and slug, names and name origins, administrative units, search, location, nearby villages, relations, publish and archive. Village does not depend on any content module.

## Owned data

`village`, `village_name`, `name_origin`, `admin_unit`, `village_affiliation`, `village_relation`. Tables are declared only in `infrastructure/persistence/schema.ts` of this module (from #3). No other module edits them.

## Public API (`index.ts`)

Empty for now. Planned:

- Village search facade (#30) with an optional `villageIds` filter, used by economy for the product filter.
- Village lookups used by the content modules, geo and profile.

## Dependencies

| Direction                         | Modules                                               |
| --------------------------------- | ----------------------------------------------------- |
| May import (besides `src/shared`) | `iam`, `curation`                                     |
| Imported by                       | `population`, `heritage`, `economy`, `geo`, `profile` |

dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Layout

| Folder            | Holds                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| `web/`            | Controllers and request/response DTOs                                               |
| `application/`    | Use cases; the transaction boundary                                                 |
| `domain/`         | Entities, value objects, rules and repository ports; plain TypeScript, no framework |
| `infrastructure/` | Adapters: Drizzle repositories and schema, Redis, HTTP clients                      |
