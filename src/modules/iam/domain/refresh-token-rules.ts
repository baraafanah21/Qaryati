import type { RefreshTokenRecord } from './refresh-token.repository';

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** A stored refresh token is a SHA-256 digest in lowercase hex, never the raw credential. */
export function isRefreshTokenHash(value: string): boolean {
  return SHA256_HEX.test(value);
}

/**
 * The invariants every stored refresh token keeps. A failure is a bug in the
 * caller, not bad client input, so it throws a plain `Error` (500).
 */
export function assertValidRefreshTokenRecord(record: RefreshTokenRecord): void {
  if (!isRefreshTokenHash(record.tokenHash)) {
    throw new Error('A refresh token hash must be 64 lowercase hex characters.');
  }
  if (record.expiresAt.getTime() <= record.createdAt.getTime()) {
    throw new Error('A refresh token must expire after it is created.');
  }
}
