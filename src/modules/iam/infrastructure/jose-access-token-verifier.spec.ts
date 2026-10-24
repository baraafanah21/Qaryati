import { generateKeyPairSync } from 'node:crypto';
import { SignJWT } from 'jose';
import { FixedClock } from '../../../shared/kernel';
import { Role } from '../domain/authenticated-user';
import { JoseAccessTokenVerifier } from './jose-access-token-verifier';

describe('RS256 access token verification', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const clock = new FixedClock('2026-10-24T10:00:00Z');
  const now = Math.floor(clock.now().getTime() / 1000);
  const id = '00000000-0000-7000-8000-000000000001';
  const verifier = new JoseAccessTokenVerifier(keys, 'qaryati-test', clock);
  const valid = { sub: id, role: Role.CONTRIBUTOR, iss: 'qaryati-test', iat: now, exp: now + 300 };
  const sign = (
    payload: Record<string, unknown>,
    key = keys.privateKey,
    alg = 'RS256',
    typ = 'JWT',
  ) => new SignJWT(payload).setProtectedHeader({ alg, typ }).sign(key);

  it.each(Object.values(Role))(
    'maps a verified %s identity without leaking extra claims',
    async (role) => {
      const user = await verifier.verify(
        await sign({ ...valid, role, email: 'ignored@example.test' }),
      );
      expect(user).toEqual({ id, role });
      expect(Object.isFrozen(user)).toBe(true);
    },
  );

  it.each(['sub', 'role', 'iat', 'exp', 'iss'])('rejects missing %s', async (field) => {
    const payload: Record<string, unknown> = { ...valid };
    delete payload[field];
    await expect(verifier.verify(await sign(payload))).rejects.toThrow();
  });

  it.each([
    { role: 'ADMINISTRATOR' },
    { role: ['ADMIN'] },
    { role: 'admin' },
    { sub: 'not-a-uuid' },
    { exp: now },
    { exp: now - 1 },
    { exp: now + 0.5 },
    { iat: now + 1 },
    { iat: now + 400, exp: now + 300 },
    { iss: 'another-issuer' },
  ])('rejects invalid claims %j', async (override) => {
    await expect(verifier.verify(await sign({ ...valid, ...override }))).rejects.toThrow();
  });

  it('rejects another key, algorithm, type, malformed token and modified payload', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await expect(verifier.verify(await sign(valid, other.privateKey))).rejects.toThrow();
    await expect(verifier.verify(await sign(valid, keys.privateKey, 'RS512'))).rejects.toThrow();
    const symmetric = await new SignJWT(valid)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .sign(new Uint8Array(32).fill(42));
    await expect(verifier.verify(symmetric)).rejects.toThrow();
    await expect(
      verifier.verify(await sign(valid, keys.privateKey, 'RS256', 'refresh+jwt')),
    ).rejects.toThrow();
    await expect(verifier.verify('malformed')).rejects.toThrow();
    const token = await sign(valid);
    const parts = token.split('.');
    parts[1] = Buffer.from(JSON.stringify({ ...valid, role: Role.ADMIN })).toString('base64url');
    await expect(verifier.verify(parts.join('.'))).rejects.toThrow();
    const unsigned = `${parts[0]}.${parts[1]}.`;
    await expect(verifier.verify(unsigned)).rejects.toThrow();
  });

  it('uses the injected clock at the expiration boundary', async () => {
    const token = await sign(valid);
    const later = new JoseAccessTokenVerifier(
      keys,
      'qaryati-test',
      new FixedClock(new Date((now + 300) * 1000)),
    );
    await expect(later.verify(token)).rejects.toThrow();
  });
});
