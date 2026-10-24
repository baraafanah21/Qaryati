import type { AuthenticatedUser } from '../domain/authenticated-user';

/** Adapter contract prevents HTTP guards from depending on cryptographic infrastructure. */
export abstract class AccessTokenVerifier {
  /** Returns a trusted identity or rejects invalid credentials. */
  abstract verify(token: string): Promise<AuthenticatedUser>;
}
