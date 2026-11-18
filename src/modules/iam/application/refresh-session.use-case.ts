import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  AUDIT_RECORDER,
  CLOCK,
  ID_GENERATOR,
  ErrorCode,
  UnauthenticatedError,
  type AuditRecorder,
  type Clock,
  type IdGenerator,
} from '../../../shared/kernel';
import { RefreshDecision, decideRefresh, refreshTokenExpiry } from '../domain/refresh-decision';
import { RefreshTokenRepository } from '../domain/refresh-token.repository';
import { UserAccountRepository } from '../domain/user-account.repository';
import { AccessTokenIssuer } from './access-token-issuer';
import type { LoginResult } from './login-user.use-case';
import { RefreshTokenGenerator } from './refresh-token-generator';
import { RefreshTokenLifetime } from './refresh-token-lifetime';
import { recordFamilyRevocation } from './session-audit';

/** The one public failure of a refresh: the same body for every rejected token. */
export function invalidRefreshToken(): UnauthenticatedError {
  return new UnauthenticatedError('The refresh token is invalid or has expired.', {
    code: ErrorCode.INVALID_CREDENTIALS,
  });
}

/**
 * Exchanges a refresh token for a new pair (rotation), following `decideRefresh`.
 *
 * The decision and its writes run in {@link RefreshSession.apply}, its own transaction,
 * which returns instead of throwing. `execute` throws the 401 only after that transaction
 * has committed, so a family revoked on reuse or for an inactive account stays revoked
 * although the response is an error.
 */
@Injectable()
export class RefreshSession {
  constructor(
    private readonly accounts: UserAccountRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly generator: RefreshTokenGenerator,
    private readonly issuer: AccessTokenIssuer,
    private readonly lifetime: RefreshTokenLifetime,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
  ) {}

  /** @throws UnauthenticatedError INVALID_CREDENTIALS for any token that is not rotated. */
  async execute(rawToken: string): Promise<LoginResult> {
    const result = await this.apply(rawToken);
    if (!result) throw invalidRefreshToken();
    return result;
  }

  /** Decides and writes in one transaction; `undefined` means "reject after commit". */
  @Transactional()
  async apply(rawToken: string): Promise<LoginResult | undefined> {
    const now = this.clock.now();
    const token = await this.refreshTokens.findByHashForUpdate(this.generator.hash(rawToken));
    const user = token && (await this.accounts.findById(token.userId));
    const decision = decideRefresh(token, user, now);
    if (!token || !user) return undefined;

    switch (decision) {
      case RefreshDecision.REJECT_UNKNOWN:
      case RefreshDecision.REJECT_EXPIRED:
        return undefined;
      case RefreshDecision.REUSE_DETECTED: {
        const revokedCount = await this.refreshTokens.revokeFamily(token.familyId, now);
        await recordFamilyRevocation(this.audit, 'session.reuse_detected', token, {
          revokedCount,
        });
        return undefined;
      }
      case RefreshDecision.REJECT_USER_INACTIVE: {
        const revokedCount = await this.refreshTokens.revokeFamily(token.familyId, now);
        if (revokedCount > 0) {
          await recordFamilyRevocation(this.audit, 'session.revoked', token, {
            revokedCount,
            reason: 'USER_INACTIVE',
          });
        }
        return undefined;
      }
      case RefreshDecision.ROTATE: {
        const next = this.generator.generate();
        const id = this.ids.next<'RefreshToken'>();
        await this.refreshTokens.insert({
          id,
          userId: token.userId,
          tokenHash: next.hash,
          familyId: token.familyId,
          createdAt: now,
          expiresAt: refreshTokenExpiry(now, this.lifetime.seconds),
        });
        await this.refreshTokens.markRotated(token.id, now, id);
        const access = await this.issuer.issue({ id: user.id, role: user.role });
        return { ...access, refreshToken: next.raw, tokenType: 'Bearer' };
      }
    }
  }
}
