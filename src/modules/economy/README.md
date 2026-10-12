# economy module

**Owner:** Hamam · **Issues:** #22, #36

## Responsibility

Products and facilities of each village, and the product filter for village search (`GET /products/{id}/villages`).

## Owned data

`product`, `village_product`, `facility`. Tables are declared only in `infrastructure/persistence/schema.ts` of this module, which `drizzle.config.ts` picks up. No other module edits them. See [docs/database.md](../../../docs/database.md).

## Public API (`index.ts`)

Empty for now. Planned:

- Read facade for products and facilities, used by profile (#39).
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
