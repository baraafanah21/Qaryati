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

Unit tests cover roles, claims, signature validation, secret files and the test issuer. `test/iam.int-spec.ts` exercises real Nest guards, HTTP, ProblemDetails, Swagger and concurrent request contexts using temporary keys and, since #14, migrated PostGIS for the expanded module wiring. Existing e2e suites still use real PostGIS. The reference template does not import IAM; its test agent wiring lives in `test/support/authenticated-agent.ts`.

Other modules' tests import `createTestTokenIssuer` from this module's index, pass `{ privateKeyFile, publicKeyFile, issuer, clock }`, then call `mint({ id, role })`. The default lifetime is 300 seconds. No fixed keys or tokens are committed. The helper is not a runtime DI provider and has no HTTP endpoint.

Account storage and registration/login are implemented in #14. Rotation/logout/me remain #18; rate limiting and temporary lockout remain #25; user administration remains #32.

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

## Registration and login (#14)

- `POST /api/v1/auth/register`: public strict body { email, password }; returns 201 with { id, email, role, status, version, createdAt, updatedAt } and ETag. New accounts are always CONTRIBUTOR/ACTIVE. Unknown role/status fields are rejected (400), duplicate email is 409 DUPLICATE. No automatic login, Location or extra profile fields.
- `POST /api/v1/auth/login`: public strict body { email, password }; returns 200 with { accessToken, refreshToken, tokenType: "Bearer", expiresIn: 900 }. Auth responses use Cache-Control: no-store. Wrong email/password, DISABLED and deleted accounts return the same 401 INVALID_CREDENTIALS detail. Nonempty short wrong passwords still execute verification; malformed bodies return 400.
- Registration intentionally returns 409 DUPLICATE for an existing email, revealing that it is registered. This is the #14 API trade-off; rate limiting in #25 is the later mitigation. Login still hides account existence with INVALID_CREDENTIALS.
- Email is trimmed/lowercased in the application; citext uniqueness is authoritative. No provider-specific alias rewriting. Passwords use 10-128 JavaScript UTF-16 code units at registration, without normalization/trimming; Argon2id m=19456 KiB, t=2, p=1. No blacklist.
- Unknown email executes Argon2 verification against a fixed valid dummy hash with identical costs, reducing timing differences without promising identical timing. Existing accounts, including unavailable ones, are verified before the login decision.
- Runtime AccessTokenIssuer uses jose and the same once-loaded RSA pair, configured issuer, typ JWT, UUID sub, one role and integer iat/exp as #10. Runtime lifetime comes from JWT_ACCESS_TTL (default 15m / 900 seconds); expiresIn reflects its validated seconds. TokenService owns the shared signing/verification contract and both adapters delegate to its single instance. The test helper uses the same signing construction while preserving its explicit lifetime overrides and 300-second test default. Guards are unchanged. Existing access tokens remain valid until expiry; account status is checked at login, not by adding database reads to #10 guards.
- RefreshTokenGenerator creates 32 random bytes encoded as base64url. Only SHA-256 hex is stored with userId, familyId, createdAt and seven-day expiresAt. The raw credential is returned only by login. No rotation, reuse detection, revocation, revokedAt, refresh/logout/me routes or family lifecycle behavior.
- Both write use cases use @Transactional and the existing AuditRecorder. Registration audits user_account.created with only email/role/status. Login audits refresh_token.issued with only userId/familyId/createdAt/expiresAt. No passwords, password hashes, raw tokens or token hashes in audit. Public routes keep the anonymous actor; the affected user is explicit in entityId/userId. The existing placeholder remains until #20.
- Internal entities, repositories, schemas and runtime signing ports are not exported from index.ts. Versioned account columns follow the reference module; no administration/delete behavior is added.

Tests cover pure rules and decisions, native hashing and RS256 compatibility, migrated PostGIS constraints/adapters, and HTTP registration/login with #10 guards, rollback and Swagger. Integration/e2e require Docker.
