# iam module

**Owner:** Hamam · **Issues:** #10, #14, #18, #25, #32

## Responsibility

Identity and access: users, registration and login, JWT access tokens, refresh-token rotation, roles and permission checks.

## Owned data

Users and refresh tokens. Tables are declared only in `infrastructure/persistence/schema.ts` of this module, which `drizzle.config.ts` picks up. No other module edits them. See [docs/database.md](../../../docs/database.md).

## Public API (`index.ts`)

Empty for now. Planned:

- `PermissionChecker` (#10): lets other modules ask whether the current user may perform an action.
- A test helper that mints tokens for other modules' tests (#10).

## Dependencies

| Direction                         | Modules                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- |
| May import (besides `src/shared`) | none                                                                         |
| Imported by                       | `curation`, `village`, `population`, `heritage`, `economy`, `geo`, `profile` |

dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Layout

| Folder            | Holds                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| `web/`            | Controllers and request/response DTOs                                               |
| `application/`    | Use cases; the transaction boundary                                                 |
| `domain/`         | Entities, value objects, rules and repository ports; plain TypeScript, no framework |
| `infrastructure/` | Adapters: Drizzle repositories and schema, Redis, HTTP clients                      |
