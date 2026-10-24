import { jwtVerify } from 'jose';
import { z } from 'zod';
import type { Clock } from '../../../shared/kernel';
import { AccessTokenVerifier } from '../application/access-token-verifier';
import { Role, type AuthenticatedUser } from '../domain/authenticated-user';
import type { JwtKeys } from './jwt-keys';

// JWTs may carry standard or future claims; only these fields form our trusted identity.
const claims = z.object({
  sub: z.uuid(),
  role: z.enum(Object.values(Role)),
  iat: z.int().nonnegative(),
  exp: z.int().nonnegative(),
});

/** Verifies only local RS256 access tokens, with time supplied by the kernel clock. */
export class JoseAccessTokenVerifier extends AccessTokenVerifier {
  constructor(
    private readonly keys: JwtKeys,
    private readonly issuer: string,
    private readonly clock: Clock,
  ) {
    super();
  }

  /** Validates the signature before trusting any identity or role claim. */
  async verify(token: string): Promise<AuthenticatedUser> {
    const now = this.clock.now();
    const { payload } = await jwtVerify(token, this.keys.publicKey, {
      algorithms: ['RS256'],
      typ: 'JWT',
      issuer: this.issuer,
      requiredClaims: ['sub', 'role', 'iat', 'exp'],
      currentDate: now,
    });
    const parsed = claims.parse(payload);
    if (parsed.exp <= parsed.iat || parsed.iat > Math.floor(now.getTime() / 1000)) {
      throw new Error('Invalid access token lifetime.');
    }
    return Object.freeze({ id: parsed.sub, role: parsed.role });
  }
}
