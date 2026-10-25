import { createHash, generateKeyPairSync } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { FixedClock } from '../../../shared/kernel';
import { Role } from '../domain/authenticated-user';
import { Argon2PasswordHasher } from './argon2-password-hasher';
import { CryptoRefreshTokenGenerator } from './crypto-refresh-token-generator';
import { JoseAccessTokenIssuer } from './jose-access-token-issuer';
import { JoseAccessTokenVerifier } from './jose-access-token-verifier';

describe('credential adapters', () => {
  it('hashes verbatim passwords with the approved Argon2id cost and random salts', async () => {
    const adapter = new Argon2PasswordHasher();
    const password = '  passphrase😀  ';
    const first = await adapter.hash(password);
    const second = await adapter.hash(password);
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,(?:t=2,p=1|p=1,t=2)\$/);
    expect(first).not.toBe(second);
    expect(await adapter.verify(first, password)).toBe(true);
    expect(await adapter.verify(first, password.trim())).toBe(false);
    await expect(adapter.verifyDummy('unknown-password')).resolves.toBeUndefined();
  });
  it('generates unique opaque 256-bit credentials with reproducible SHA-256 digests', () => {
    const generator = new CryptoRefreshTokenGenerator();
    const first = generator.generate();
    const second = generator.generate();
    expect(first.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first.raw, 'base64url')).toHaveLength(32);
    expect(first.hash).toBe(createHash('sha256').update(first.raw).digest('hex'));
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.raw).not.toBe(second.raw);
    expect(first.hash).not.toBe(second.hash);
  });
  it('issues the exact RS256 contract accepted by the existing #10 verifier', async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const clock = new FixedClock('2026-10-25T10:00:00Z');
    const issuer = new JoseAccessTokenIssuer(keys, 'test', clock);
    const verifier = new JoseAccessTokenVerifier(keys, 'test', clock);
    const identity = { id: '00000000-0000-7000-8000-000000000001', role: Role.CONTRIBUTOR };
    const result = await issuer.issue(identity);
    expect(result.expiresIn).toBe(300);
    expect(decodeProtectedHeader(result.accessToken)).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = decodeJwt(result.accessToken);
    const now = Math.floor(clock.now().getTime() / 1000);
    expect(claims).toEqual({
      sub: identity.id,
      role: identity.role,
      iss: 'test',
      iat: now,
      exp: now + 300,
    });
    await expect(verifier.verify(result.accessToken)).resolves.toEqual(identity);
  });
});
