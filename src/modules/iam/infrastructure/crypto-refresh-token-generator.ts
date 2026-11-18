import { createHash, randomBytes } from 'node:crypto';
import { RefreshTokenGenerator } from '../application/refresh-token-generator';

/** SHA-256 of a raw refresh token as 64 lowercase hex characters: the only form that is stored. */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** A 256-bit opaque credential; only its SHA-256 digest crosses the persistence port. */
export class CryptoRefreshTokenGenerator extends RefreshTokenGenerator {
  generate(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: hashRefreshToken(raw) };
  }

  hash(raw: string): string {
    return hashRefreshToken(raw);
  }
}
