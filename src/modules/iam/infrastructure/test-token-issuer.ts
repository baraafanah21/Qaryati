import { SignJWT } from 'jose';
import type { Clock } from '../../../shared/kernel';
import type { AuthenticatedUser } from '../domain/authenticated-user';
import { loadJwtKeys } from './jwt-keys';

/** Explicit test configuration; no environment reads or embedded test secrets. */
export interface TestTokenIssuerOptions {
  privateKeyFile: string;
  publicKeyFile: string;
  issuer: string;
  clock: Clock;
}

/** A test-only signer, never registered as a production provider or exposed over HTTP. */
export interface TestTokenIssuer {
  /** Mints a short-lived token; a negative lifetime supports expired-token tests. */
  mint(user: AuthenticatedUser, lifetimeSeconds?: number): Promise<string>;
}

/** Creates a signer for other modules' tests using their temporary secret files. */
export async function createTestTokenIssuer(
  options: TestTokenIssuerOptions,
): Promise<TestTokenIssuer> {
  const keys = await loadJwtKeys(options.privateKeyFile, options.publicKeyFile);
  return {
    mint(user, lifetimeSeconds = 300) {
      const issuedAt = Math.floor(options.clock.now().getTime() / 1000);
      return new SignJWT({ role: user.role })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setSubject(user.id)
        .setIssuer(options.issuer)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + lifetimeSeconds)
        .sign(keys.privateKey);
    },
  };
}
