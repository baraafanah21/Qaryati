import { AccountStatus } from './account-status';
import type { StoredRefreshToken } from './refresh-token.repository';

/** What to do with a presented refresh token; the use case acts on the result. */
export const RefreshDecision = {
  /** Valid: revoke it, link it to a new token in the same family and issue a new pair. */
  ROTATE: 'ROTATE',
  /** No stored token has this digest. */
  REJECT_UNKNOWN: 'REJECT_UNKNOWN',
  /** The token is past its expiry. */
  REJECT_EXPIRED: 'REJECT_EXPIRED',
  /** The token was already revoked: someone kept an old copy, so the family is revoked. */
  REUSE_DETECTED: 'REUSE_DETECTED',
  /** The account may no longer sign in, so the family is revoked. */
  REJECT_USER_INACTIVE: 'REJECT_USER_INACTIVE',
} as const;

/** One of the {@link RefreshDecision} values. */
export type RefreshDecision = (typeof RefreshDecision)[keyof typeof RefreshDecision];

/** True when the token can no longer be used at `now`; expiry is exclusive of its last instant. */
export function isRefreshTokenExpired(token: Pick<StoredRefreshToken, 'expiresAt'>, now: Date) {
  return now.getTime() >= token.expiresAt.getTime();
}

/** Expiry of a token created at `createdAt` with a lifetime of `lifetimeSeconds`. */
export function refreshTokenExpiry(createdAt: Date, lifetimeSeconds: number): Date {
  return new Date(createdAt.getTime() + lifetimeSeconds * 1000);
}

/**
 * Decides what happens to a presented refresh token. Pure: the caller loads the token
 * (locked) and its owner, and passes the current time from the Clock.
 *
 * Order matters: a revoked token is reuse even when it has also expired, because the
 * family must still be revoked; an expired token is rejected before the account is
 * looked at, so expiry alone never revokes anything.
 */
export function decideRefresh(
  token: Pick<StoredRefreshToken, 'expiresAt' | 'revokedAt'> | undefined,
  user: { status: AccountStatus } | undefined,
  now: Date,
): RefreshDecision {
  if (!token || !user) return RefreshDecision.REJECT_UNKNOWN;
  if (token.revokedAt !== null) return RefreshDecision.REUSE_DETECTED;
  if (isRefreshTokenExpired(token, now)) return RefreshDecision.REJECT_EXPIRED;
  if (user.status !== AccountStatus.ACTIVE) return RefreshDecision.REJECT_USER_INACTIVE;
  return RefreshDecision.ROTATE;
}
