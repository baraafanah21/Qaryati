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

Account storage and registration/login are implemented in #14; refresh rotation, logout and `/auth/me` in #18; lockout in #25 and user administration in #32 (sections below). The rate limits themselves are platform code (`src/platform/rate-limit`); IAM only marks login with `@LoginRateLimit()`.

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
- `POST /api/v1/auth/login`: public strict body { email, password }; returns 200 with { accessToken, refreshToken, tokenType: "Bearer", expiresIn: 900 }. Auth responses use Cache-Control: no-store. Wrong email/password and DISABLED accounts return the same 401 INVALID_CREDENTIALS detail. Nonempty short wrong passwords still execute verification; malformed bodies return 400.
- Registration intentionally returns 409 DUPLICATE for an existing email, revealing that it is registered. This is the #14 API trade-off; rate limiting in #25 is the later mitigation. Login still hides account existence with INVALID_CREDENTIALS.
- Email is trimmed/lowercased in the application; citext uniqueness is authoritative. No provider-specific alias rewriting. Passwords use 10-128 JavaScript UTF-16 code units at registration, without normalization/trimming; Argon2id m=19456 KiB, t=2, p=1. No blacklist.
- Unknown email executes Argon2 verification against a fixed valid dummy hash with identical costs, reducing timing differences without promising identical timing. Existing accounts, including unavailable ones, are verified before the login decision.
- Runtime AccessTokenIssuer uses jose and the same once-loaded RSA pair, configured issuer, typ JWT, UUID sub, one role and integer iat/exp as #10. Runtime lifetime comes from JWT_ACCESS_TTL (default 15m / 900 seconds); expiresIn reflects its validated seconds. TokenService owns the shared signing/verification contract and both adapters delegate to its single instance. The test helper uses the same signing construction while preserving its explicit lifetime overrides and 300-second test default. Guards are unchanged. Existing access tokens remain valid until expiry; account status is checked at login, not by adding database reads to #10 guards.
- RefreshTokenGenerator creates 32 random bytes encoded as base64url. Only SHA-256 hex is stored with userId, familyId, createdAt and expiresAt (`JWT_REFRESH_TTL`, default seven days). The raw credential is returned only by login and, since #18, by refresh. Login starts a new family; the session lifecycle is described below.
- Both write use cases use @Transactional and the existing AuditRecorder. Registration audits user_account.created; the audit allow-list keeps only role/status (no email: personal data in a trail that is never purged). Login audits refresh_token.issued; the audit allow-list keeps only userId/familyId/expiresAt (the entry's occurred_at is the creation time). No passwords, password hashes, raw tokens or token hashes in audit. Public routes keep the anonymous actor; the affected user is explicit in entityId/userId.
- Internal entities, repositories, schemas and runtime signing ports are not exported from index.ts. Versioned account columns follow the reference module; no administration/delete behavior is added.

Tests cover pure rules and decisions, native hashing and RS256 compatibility, migrated PostGIS constraints/adapters, and HTTP registration/login with #10 guards, rollback and Swagger. Integration/e2e require Docker.

## Sessions: refresh rotation, logout and `/auth/me` (#18)

**Lifetimes.** An access token lives `JWT_ACCESS_TTL` (15 minutes by default) and is never stored. A refresh token lives `JWT_REFRESH_TTL` (7 days by default), is returned once in clear and stored only as its SHA-256 hex digest. Every new row passes `refresh-token-rules.ts` (64 lowercase hex characters, expiry after creation).

**Families.** Login starts a family (`family_id`). Each refresh replaces the presented token with a new one in the same family, so a family is one sign-in on one device, and its tokens form a chain linked by `replaced_by_id`.

**The decision is domain code.** `decideRefresh(token, user, now)` in `domain/refresh-decision.ts` is pure and returns one of:

| Decision               | When                                       | What the use case does                   |
| ---------------------- | ------------------------------------------ | ---------------------------------------- |
| `REJECT_UNKNOWN`       | no row has the digest (or no owner)        | 401                                      |
| `REUSE_DETECTED`       | the token is already revoked               | revoke the family, audit, 401            |
| `REJECT_EXPIRED`       | `now >= expiresAt` (time from the `Clock`) | 401, nothing revoked                     |
| `REJECT_USER_INACTIVE` | the account is not `ACTIVE`                | revoke the family, audit, 401            |
| `ROTATE`               | otherwise                                  | revoke and link the old row, insert, 200 |

Expiry, revocation and account status are checked in code only: no trigger, no `CHECK`, no business condition in SQL. The repository reads and writes; the one SQL condition is `revoked_at IS NULL` when a family is revoked.

**Refresh flow.**

```mermaid
sequenceDiagram
  participant C as Client
  participant A as POST /auth/refresh
  participant D as PostgreSQL
  C->>A: { refreshToken }
  A->>D: BEGIN; SELECT ... WHERE token_hash = sha256(token) FOR UPDATE
  A->>D: SELECT account by user_id
  Note over A: decideRefresh(token, account, clock.now())
  alt ROTATE
    A->>D: INSERT new token (same family)
    A->>D: UPDATE old SET revoked_at, replaced_by_id
    A->>D: COMMIT
    A-->>C: 200 { accessToken, refreshToken, tokenType, expiresIn }
  else REUSE_DETECTED / REJECT_USER_INACTIVE
    A->>D: UPDATE family SET revoked_at WHERE revoked_at IS NULL; audit
    A->>D: COMMIT
    A-->>C: 401 INVALID_CREDENTIALS
  else REJECT_UNKNOWN / REJECT_EXPIRED
    A->>D: COMMIT (nothing written)
    A-->>C: 401 INVALID_CREDENTIALS
  end
```

**Reuse detection.** A revoked token presented again means someone kept an old copy: the thief or the real client, we cannot tell which, so the whole family is revoked and both must sign in again. The revocation must survive although the response is an error. `RefreshSession.execute` therefore calls `apply`, a separate `@Transactional()` method that decides, writes and returns `undefined` instead of throwing; the transaction commits, and only then does `execute` throw the 401. Every rejection has the same body (`INVALID_CREDENTIALS`, "The refresh token is invalid or has expired."), so a client learns nothing about why.

**Concurrency.** The presented row is read with `SELECT ... FOR UPDATE`. Of two refreshes with the same token, the second waits for the first to commit, then reads the row as revoked: reuse. Exactly one caller gets new tokens, and the reuse revokes the family, including the token the winner just received. Logout locks the row the same way, so a logout racing a rotation never leaves the new token active.

**Logout.** `POST /auth/logout` (public, body `{ refreshToken }`) revokes every active token of that token's family and always answers 204, also for an unknown or already revoked token: it is idempotent and reveals nothing. Other sessions (families) of the same user stay valid.

**`GET /auth/me`.** Needs an access token; returns `{ id, email, role, status }` read from the database, not from the token claims, so a role changed by an admin shows at once. The account has no display name yet, so none is returned. A token whose account no longer exists gets 401.

**Audit.** `session.revoked` (logout, or a disabled account's refresh; `reason` is `LOGOUT` or `USER_INACTIVE`) and `session.reuse_detected`, both with entity `RefreshTokenFamily` and the family id; snapshots hold `userId`, `reason` and `revokedCount`, never a token or digest. A logout that revokes nothing records nothing. A normal rotation is not audited: an active user rotates every 15 minutes, so one entry per user per 15 minutes would drown the audit log in routine events. The rotation is still traceable in `refresh_token` itself (`revoked_at`, `replaced_by_id`).

## Login lockout and rate limits (#25)

**Rate limits** are global (platform, [configuration](../../../docs/configuration.md#security-and-operations)): 120 requests per minute per IP without a token, 300 per user with one. `POST /auth/login` adds 5 attempts per minute per IP and email (`@LoginRateLimit()`), with the email lowercased and trimmed so case variants share one counter. Over a limit: 429 `RATE_LIMITED` with `Retry-After`.

**Lockout** protects each account even from an attacker who rotates IPs. The rules are pure functions in `domain/login-lockout.ts`:

| Situation                              | Result                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| wrong password, not locked             | `failed_login_count + 1`                                                               |
| 10th consecutive failure               | `locked_until = now + 15 min`, count back to 0, audited `account.locked`               |
| any attempt while locked, even correct | the same 401 `INVALID_CREDENTIALS` as a wrong password; not counted, lock not extended |
| correct password, not locked, ACTIVE   | login succeeds; count and `locked_until` reset (one write, only when they are set)     |
| unknown email or DISABLED account      | 401, nothing counted                                                                   |

- **No enumeration:** a locked account answers exactly like a wrong password, and the password is still verified so the timing does not differ either.
- **No permanent lock-out by others:** failures during a lock neither count nor extend it, so whoever knows an email can lock it for at most 15 minutes at a time.
- **The counter survives the 401:** like refresh reuse (#18), `LoginUser.attempt` decides and writes in its own `@Transactional()` method and returns `undefined`; `execute` throws only after the commit. The account is read `FOR UPDATE`, so concurrent attempts count one by one.
- **Audit:** `account.locked` (entity `UserAccount`, `after: { lockedUntil }`). Single failed attempts are not audited: they are routine and the counter is in the row; a lock is the security event.
- Time comes from the `Clock`, so the e2e test moves a `FixedClock` 15 minutes forward instead of waiting.

## User administration (#32)

ADMIN only (`@Roles(Role.ADMIN)` on `UsersController`):

| Endpoint                                                  | Result                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/v1/users?role=&status=&page=&size=`             | `Page<UserAccountResponse>`, oldest first; never a credential                |
| `PATCH /api/v1/users/{id}/role` `{ role }` + If-Match     | 200 with the new version as ETag; 404, 412, 428 as for every versioned write |
| `PATCH /api/v1/users/{id}/status` `{ status }` + If-Match | the same; `DISABLED` blocks login and refresh                                |

- **Sessions end:** every change revokes all refresh tokens of every family of the account (`revokeAllForUser`), in the same transaction. The user must log in again and gets a token with the new role; a disabled user cannot. Access tokens already issued stay valid until they expire (`JWT_ACCESS_TTL`, 15 minutes), because the JWT guard does not read the database (#10). `/auth/me` shows the change at once.
- **Not your own account:** an administrator who targets themself gets 422 `SELF_ADMINISTRATION_FORBIDDEN` (`domain/account-administration.ts`), so the last administrator cannot lock everybody out.
- **Audit:** `user_account.role_changed` / `user_account.status_changed` with `before`/`after` `{ role, status }` and `revokedCount`; never the email.
- No delete endpoint: an account is disabled, not deleted (no soft delete, docs/data-model.md).
