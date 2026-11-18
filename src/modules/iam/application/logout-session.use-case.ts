import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { AUDIT_RECORDER, CLOCK, type AuditRecorder, type Clock } from '../../../shared/kernel';
import { RefreshTokenRepository } from '../domain/refresh-token.repository';
import { RefreshTokenGenerator } from './refresh-token-generator';
import { recordFamilyRevocation } from './session-audit';

/**
 * Ends a session: revokes every active token of the presented token's family.
 * Idempotent and silent: an unknown or already revoked token changes nothing and the
 * caller still answers 204, so logout reveals nothing about a token.
 */
@Injectable()
export class LogoutSession {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly generator: RefreshTokenGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
  ) {}

  @Transactional()
  async execute(rawToken: string): Promise<void> {
    // The lock orders logout against a concurrent rotation of the same token: either the
    // rotation commits first and its new token is revoked here, or it sees a revoked token.
    const token = await this.refreshTokens.findByHashForUpdate(this.generator.hash(rawToken));
    if (!token) return;
    const revokedCount = await this.refreshTokens.revokeFamily(token.familyId, this.clock.now());
    if (revokedCount === 0) return;
    await recordFamilyRevocation(this.audit, 'session.revoked', token, {
      revokedCount,
      reason: 'LOGOUT',
    });
  }
}
