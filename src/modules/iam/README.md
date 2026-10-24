# iam module

**Owner:** Hamam · **Issues:** #10, #14, #18, #25, #32

## Responsibility

Identity and access: users, registration and login, JWT access tokens, refresh-token rotation, roles and permission checks.

## Owned data

Users and refresh tokens. Tables are declared only in `infrastructure/persistence/schema.ts` of this module, which `drizzle.config.ts` picks up. No other module edits them. See [docs/database.md](../../../docs/database.md).

## Public API (`index.ts`)

- `Role`, `AuthenticatedUser`: one uppercase role per identity, matching the planned account role in #14.
- `PermissionChecker`: framework-free `hasRole(user, role)` and `hasAnyRole(user, roles)` checks.
- `@Public()`, `@Roles(...)`, `@CurrentUser()`: HTTP access declarations and the verified identity.
- `createTestTokenIssuer(options)`: signs tokens for other modules' tests with temporary key files and an injected clock.

## JWT access boundary (#10)

`IamModule` registers global `JwtAuthGuard` and `RolesGuard`, in that order. Every routed endpoint is authenticated by default. A bearer token must have an RS256 signature, `typ: JWT`, the configured issuer, UUID `sub`, one `role`, integer `iat` and `exp`, and a valid lifetime. The guard exposes only `{ id: sub, role }` and calls the existing `RequestContext.setActorId(user.id)` after verification. No account lookup occurs in #10.

Roles are `CONTRIBUTOR`, `EDITOR`, `ADMIN`, with `ADMIN >= EDITOR >= CONTRIBUTOR`. `@Roles(A, B)` accepts either requirement, including inherited roles. A method's requirements replace the controller's. Missing role metadata allows any authenticated caller. `PermissionChecker` returns booleans; only the HTTP guards throw Nest `UnauthorizedException` or `ForbiddenException`, mapped by the existing ProblemDetails filter.

`@Public()` skips authentication entirely, including when credentials are supplied. `@CurrentUser()` then returns `undefined` and no actor is set. Combining public and role metadata denies access. The public decorator lives in platform HTTP to keep health independent of IAM and is re-exported here for business modules.

Keys are read once at startup from `JWT_PRIVATE_KEY_FILE` (PKCS#8 PEM) and `JWT_PUBLIC_KEY_FILE` (SPKI PEM). Startup rejects missing, malformed, non-RSA, mismatched or shorter-than-2048-bit pairs. `JWT_ISSUER` defaults to `qaryati`. See [configuration](../../../docs/configuration.md) and [development](../../../docs/development.md) for local generation and Compose secrets.

## Testing

Unit tests cover roles, claims, signature validation, secret files and the test issuer. `test/iam.int-spec.ts` exercises real Nest guards, HTTP, ProblemDetails, Swagger and concurrent request contexts using temporary keys, without persistence. Existing e2e suites still use real PostGIS. The reference template does not import IAM; its test agent wiring lives in `test/support/authenticated-agent.ts`.

Other modules' tests import `createTestTokenIssuer` from this module's index, pass `{ privateKeyFile, publicKeyFile, issuer, clock }`, then call `mint({ id, role })`. The default lifetime is 300 seconds. No fixed keys or tokens are committed. The helper is not a runtime DI provider and has no HTTP endpoint.

Account storage, registration/login (#14), refresh tokens/logout (#18), role assignment and resource ownership policies remain outside #10. There are no IAM tables or production endpoints yet.

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
