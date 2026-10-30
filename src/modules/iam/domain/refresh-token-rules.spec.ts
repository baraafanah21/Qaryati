import { asId } from '../../../shared/kernel';
import { assertValidRefreshTokenRecord, isRefreshTokenHash } from './refresh-token-rules';
import type { RefreshTokenRecord } from './refresh-token.repository';

describe('refresh token rules', () => {
  const createdAt = new Date('2026-10-25T10:00:00Z');
  const record: RefreshTokenRecord = {
    id: asId<'RefreshToken'>('00000000-0000-7000-8000-000000000001'),
    userId: asId<'UserAccount'>('00000000-0000-7000-8000-000000000002'),
    tokenHash: 'a1'.repeat(32),
    familyId: asId<'RefreshTokenFamily'>('00000000-0000-7000-8000-000000000003'),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 1000),
  };

  it('accepts a 64-character lowercase hex digest', () => {
    expect(isRefreshTokenHash('0123456789abcdef'.repeat(4))).toBe(true);
  });

  it.each([
    ['63 characters', 'a'.repeat(63)],
    ['65 characters', 'a'.repeat(65)],
    ['uppercase hex', 'A'.repeat(64)],
    ['a non-hex letter', `${'a'.repeat(63)}g`],
    ['a raw base64url token', 'raw-token'],
    ['empty', ''],
  ])('rejects a hash with %s', (_case, hash) => {
    expect(isRefreshTokenHash(hash)).toBe(false);
  });

  it('accepts a valid record', () => {
    expect(() => assertValidRefreshTokenRecord(record)).not.toThrow();
  });

  it('rejects a record whose hash is not a digest', () => {
    expect(() => assertValidRefreshTokenRecord({ ...record, tokenHash: 'raw-token' })).toThrow(
      /64 lowercase hex/,
    );
  });

  it.each([
    ['at', 0],
    ['before', -1000],
  ])('rejects a record that expires %s its creation time', (_case, offset) => {
    expect(() =>
      assertValidRefreshTokenRecord({
        ...record,
        expiresAt: new Date(createdAt.getTime() + offset),
      }),
    ).toThrow(/expire after/);
  });
});
