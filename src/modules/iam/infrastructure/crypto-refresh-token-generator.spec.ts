import { isRefreshTokenHash } from '../domain/refresh-token-rules';
import { CryptoRefreshTokenGenerator, hashRefreshToken } from './crypto-refresh-token-generator';

describe('refresh token hashing', () => {
  it('is the SHA-256 of the raw token in lowercase hex', () => {
    // Known vector: SHA-256("abc").
    expect(hashRefreshToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('always produces a digest the stored-token rules accept', () => {
    expect(
      isRefreshTokenHash(hashRefreshToken('q3vX9cO1Yb2m7Zt5Wd0pLk8sRj4uHf6eNa1gTc3iVyE')),
    ).toBe(true);
  });

  it('hashes a presented token exactly as the generator hashed it at issuance', () => {
    const generator = new CryptoRefreshTokenGenerator();
    const issued = generator.generate();
    expect(issued.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generator.hash(issued.raw)).toBe(issued.hash);
    expect(generator.hash(`${issued.raw}x`)).not.toBe(issued.hash);
  });
});
