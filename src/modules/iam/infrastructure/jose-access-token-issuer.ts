import { SignJWT } from 'jose';
import type { Clock } from '../../../shared/kernel';
import { AccessTokenIssuer } from '../application/access-token-issuer';
import type { AuthenticatedUser } from '../domain/authenticated-user';
import type { JwtKeys } from './jwt-keys';

/** #14 policy: five-minute access tokens, using the unchanged #10 RS256 contract. */
export class JoseAccessTokenIssuer extends AccessTokenIssuer {
  constructor(
    private readonly keys: JwtKeys,
    private readonly issuer: string,
    private readonly clock: Clock,
  ) {
    super();
  }

  async issue(user: AuthenticatedUser): Promise<{ accessToken: string; expiresIn: number }> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const expiresIn = 300;
    const accessToken = await new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(this.issuer)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + expiresIn)
      .sign(this.keys.privateKey);
    return { accessToken, expiresIn };
  }
}
