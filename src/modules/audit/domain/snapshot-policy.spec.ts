import {
  allowedFields,
  applySnapshotPolicy,
  SNAPSHOT_POLICY,
  type SnapshotPolicy,
} from './snapshot-policy';

describe('snapshot policy', () => {
  it('keeps the allowed fields and drops the others, the email included', () => {
    expect(
      applySnapshotPolicy(SNAPSHOT_POLICY, 'UserAccount', {
        email: 'a@example.org',
        role: 'CONTRIBUTOR',
        status: 'ACTIVE',
        displayName: 'not listed',
        version: 1,
      }),
    ).toEqual({ role: 'CONTRIBUTOR', status: 'ACTIVE' });
  });

  it('keeps no field of a policy entry that is not in the snapshot', () => {
    expect(applySnapshotPolicy(SNAPSHOT_POLICY, 'Source', { title: 'A book' })).toEqual({
      title: 'A book',
    });
  });

  it('returns undefined for a missing snapshot, after checking the type', () => {
    expect(applySnapshotPolicy(SNAPSHOT_POLICY, 'Source', undefined)).toBeUndefined();
    expect(() => applySnapshotPolicy(SNAPSHOT_POLICY, 'Nope', undefined)).toThrow(/"Nope"/);
  });

  it.each(['passwordHash', 'refreshToken', 'clientSecret', 'tokenHash', 'PASSWORD', 'value_hash'])(
    'always drops the secret-looking key %s, even when an allow-list names it',
    (key) => {
      const careless: SnapshotPolicy = { Thing: [key, 'name'] };
      expect(applySnapshotPolicy(careless, 'Thing', { [key]: 'x', name: 'kept' })).toEqual({
        name: 'kept',
      });
    },
  );

  it('keeps valueHash and value_hash on Claim, which are not secrets', () => {
    const policy: SnapshotPolicy = { Claim: ['valueHash', 'value_hash', 'passwordHash'] };
    expect(
      applySnapshotPolicy(policy, 'Claim', {
        valueHash: 'abc',
        value_hash: 'def',
        passwordHash: 'x',
      }),
    ).toEqual({ valueHash: 'abc', value_hash: 'def' });
    expect(applySnapshotPolicy(SNAPSHOT_POLICY, 'Claim', { valueHash: 'abc' })).toEqual({
      valueHash: 'abc',
    });
  });

  it('does not keep a refresh token hash, which is not in its list either', () => {
    expect(SNAPSHOT_POLICY.RefreshToken).not.toContain('tokenHash');
    expect(
      applySnapshotPolicy(SNAPSHOT_POLICY, 'RefreshToken', {
        id: 'r1',
        userId: 'u1',
        familyId: 'f1',
        expiresAt: '2026-11-23T10:00:00.000Z',
        createdAt: '2026-11-16T10:00:00.000Z',
        tokenHash: 'deadbeef',
      }),
    ).toEqual({ id: 'r1', userId: 'u1', familyId: 'f1', expiresAt: '2026-11-23T10:00:00.000Z' });
  });

  it('throws for an unknown entity type, naming the type and the file to edit', () => {
    expect(() => allowedFields(SNAPSHOT_POLICY, 'Village2')).toThrow(
      /"Village2".*src\/modules\/audit\/domain\/snapshot-policy\.ts/,
    );
  });

  it('does not treat inherited object keys as entity types', () => {
    expect(() => allowedFields(SNAPSHOT_POLICY, 'toString')).toThrow(/"toString"/);
  });

  it('has an entry for every entity type the use cases record today', () => {
    expect(Object.keys(SNAPSHOT_POLICY).sort()).toEqual([
      'AdminUnit',
      'Claim',
      'RefreshToken',
      'RefreshTokenFamily',
      'Source',
      'UserAccount',
      'Village',
    ]);
  });

  it('lists no secret-looking field except the known non-secrets', () => {
    const offenders = Object.entries(SNAPSHOT_POLICY).flatMap(([type, fields]) =>
      fields
        .filter((field) => /password|token|secret|hash/i.test(field))
        .map((field) => `${type}.${field}`),
    );
    expect(offenders).toEqual(['Claim.valueHash']);
  });
});
