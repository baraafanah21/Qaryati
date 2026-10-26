import type { AuthenticatedUser } from '../domain/authenticated-user';

/** Runtime signing contract shares #10's identity without exposing cryptographic keys. */
export abstract class AccessTokenIssuer {
  abstract issue(user: AuthenticatedUser): Promise<{ accessToken: string; expiresIn: number }>;
}
