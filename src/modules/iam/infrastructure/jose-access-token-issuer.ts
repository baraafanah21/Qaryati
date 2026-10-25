import { AccessTokenIssuer } from '../application/access-token-issuer';
import type { AuthenticatedUser } from '../domain/authenticated-user';
import type { TokenService } from './token.service';

/** Application signing adapter; the shared service owns the entire JWT contract. */
export class JoseAccessTokenIssuer extends AccessTokenIssuer {
  constructor(private readonly tokens: TokenService) {
    super();
  }

  issue(user: AuthenticatedUser): Promise<{ accessToken: string; expiresIn: number }> {
    return this.tokens.issue(user);
  }
}
