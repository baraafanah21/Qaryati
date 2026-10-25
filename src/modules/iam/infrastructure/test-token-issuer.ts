import type { Clock } from '../../../shared/kernel';
import type { AuthenticatedUser } from '../domain/authenticated-user';
import { loadJwtKeys } from './jwt-keys';
import { TokenService } from './token.service';

const DEFAULT_TEST_LIFETIME_SECONDS = 300;

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
  const tokens = new TokenService(
    keys,
    options.issuer,
    options.clock,
    DEFAULT_TEST_LIFETIME_SECONDS,
  );
  return {
    mint(user, lifetimeSeconds = DEFAULT_TEST_LIFETIME_SECONDS) {
      return tokens.sign(user, lifetimeSeconds);
    },
  };
}
