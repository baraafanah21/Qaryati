import { AccountStatus } from './account-status';
import {
  RefreshDecision,
  decideRefresh,
  isRefreshTokenExpired,
  refreshTokenExpiry,
} from './refresh-decision';

describe('decideRefresh', () => {
  const now = new Date('2026-10-25T10:00:00Z');
  const active = { status: AccountStatus.ACTIVE };
  const disabled = { status: AccountStatus.DISABLED };
  const valid = { expiresAt: new Date(now.getTime() + 1000), revokedAt: null };

  it('rotates a valid, unrevoked token of an active account', () => {
    expect(decideRefresh(valid, active, now)).toBe(RefreshDecision.ROTATE);
  });

  it('rejects an unknown token', () => {
    expect(decideRefresh(undefined, active, now)).toBe(RefreshDecision.REJECT_UNKNOWN);
  });

  it('rejects a token whose account cannot be found as unknown', () => {
    expect(decideRefresh(valid, undefined, now)).toBe(RefreshDecision.REJECT_UNKNOWN);
  });

  it.each([
    ['at its expiry instant', 0],
    ['after its expiry', -1],
  ])('rejects a token %s as expired', (_case, offset) => {
    const token = { expiresAt: new Date(now.getTime() + offset), revokedAt: null };
    expect(decideRefresh(token, active, now)).toBe(RefreshDecision.REJECT_EXPIRED);
  });

  it('detects reuse of a revoked token', () => {
    const token = { ...valid, revokedAt: new Date(now.getTime() - 1000) };
    expect(decideRefresh(token, active, now)).toBe(RefreshDecision.REUSE_DETECTED);
  });

  it('treats a revoked token as reuse even when it has also expired', () => {
    const token = { expiresAt: new Date(now.getTime() - 1), revokedAt: now };
    expect(decideRefresh(token, active, now)).toBe(RefreshDecision.REUSE_DETECTED);
  });

  it('rejects a valid token of a disabled account', () => {
    expect(decideRefresh(valid, disabled, now)).toBe(RefreshDecision.REJECT_USER_INACTIVE);
  });

  it('rejects an expired token of a disabled account as expired, not inactive', () => {
    const token = { expiresAt: now, revokedAt: null };
    expect(decideRefresh(token, disabled, now)).toBe(RefreshDecision.REJECT_EXPIRED);
  });
});

describe('refresh token lifetime', () => {
  const createdAt = new Date('2026-10-25T10:00:00Z');

  it('adds the lifetime in seconds to the creation time', () => {
    expect(refreshTokenExpiry(createdAt, 604800).toISOString()).toBe('2026-11-01T10:00:00.000Z');
  });

  it('is valid until, but not at, its expiry instant', () => {
    const token = { expiresAt: refreshTokenExpiry(createdAt, 60) };
    expect(isRefreshTokenExpired(token, new Date(createdAt.getTime() + 59_999))).toBe(false);
    expect(isRefreshTokenExpired(token, new Date(createdAt.getTime() + 60_000))).toBe(true);
  });
});
