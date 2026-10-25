import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Clock } from '../../../shared/kernel';
import { Role, type AuthenticatedUser } from '../domain/authenticated-user';
import type { JwtKeys } from './jwt-keys';

const ALGORITHM = 'RS256';
const TOKEN_TYPE = 'JWT';
// Extra claims remain permitted, as in #10; only these fields form the trusted identity.
const claims = z.object({
  sub: z.uuid(),
  role: z.enum(Object.values(Role)),
  iat: z.int().nonnegative(),
  exp: z.int().nonnegative(),
});

/** Shared signing and verification contract, using the once-loaded keys and validated runtime TTL. */
export class TokenService {
  constructor(
    private readonly keys: JwtKeys,
    private readonly issuer: string,
    private readonly clock: Clock,
    private readonly accessTtlSeconds: number,
  ) {}

  /** Production issuance always uses the configured lifetime, returned in seconds. */
  async issue(user: AuthenticatedUser): Promise<{ accessToken: string; expiresIn: number }> {
    return {
      accessToken: await this.sign(user, this.accessTtlSeconds),
      expiresIn: this.accessTtlSeconds,
    };
  }

  /** Explicit lifetime also supports the public test helper's expired-token fixtures. */
  sign(user: AuthenticatedUser, lifetimeSeconds: number): Promise<string> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    return new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: ALGORITHM, typ: TOKEN_TYPE })
      .setSubject(user.id)
      .setIssuer(this.issuer)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + lifetimeSeconds)
      .sign(this.keys.privateKey);
  }

  /** Retains #10's validation without imposing the issuance TTL on existing tokens. */
  async verify(token: string): Promise<AuthenticatedUser> {
    const now = this.clock.now();
    const { payload } = await jwtVerify(token, this.keys.publicKey, {
      algorithms: [ALGORITHM],
      typ: TOKEN_TYPE,
      issuer: this.issuer,
      requiredClaims: ['sub', 'role', 'iat', 'exp'],
      currentDate: now,
    });
    const parsed = claims.parse(payload);
    if (parsed.exp <= parsed.iat || parsed.iat > Math.floor(now.getTime() / 1000))
      throw new Error('Invalid access token lifetime.');
    return Object.freeze({ id: parsed.sub, role: parsed.role });
  }
}
