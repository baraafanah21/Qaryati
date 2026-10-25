import { createHash, randomBytes } from 'node:crypto';
import { RefreshTokenGenerator } from '../application/refresh-token-generator';

/** A 256-bit opaque credential; only its SHA-256 digest crosses the persistence port. */
export class CryptoRefreshTokenGenerator extends RefreshTokenGenerator {
  generate(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: createHash('sha256').update(raw).digest('hex') };
  }
}
