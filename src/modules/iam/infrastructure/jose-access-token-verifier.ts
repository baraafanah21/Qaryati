import { AccessTokenVerifier } from '../application/access-token-verifier';
import type { AuthenticatedUser } from '../domain/authenticated-user';
import type { TokenService } from './token.service';

/** Preserves #10's application port while sharing cryptography with runtime issuance. */
export class JoseAccessTokenVerifier extends AccessTokenVerifier {
  constructor(private readonly tokens: TokenService) {
    super();
  }

  verify(token: string): Promise<AuthenticatedUser> {
    return this.tokens.verify(token);
  }
}
