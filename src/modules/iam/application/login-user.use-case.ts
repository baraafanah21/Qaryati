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
import { normalizeEmail } from '../domain/email';
import { RefreshTokenRepository } from '../domain/refresh-token.repository';
import { UserAccountRepository } from '../domain/user-account.repository';
import { AccessTokenIssuer } from './access-token-issuer';
import { PasswordHasher } from './password-hasher';
import { RefreshTokenGenerator } from './refresh-token-generator';

/** Login response; credentials must never be placed in logs or audit payloads. */
export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

/** A successful login writes one hashed refresh token; #18 owns its later lifecycle. */
@Injectable()
export class LoginUser {
  constructor(
    private readonly accounts: UserAccountRepository,
    private readonly passwords: PasswordHasher,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly generator: RefreshTokenGenerator,
    private readonly issuer: AccessTokenIssuer,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
  ) {}

  @Transactional()
  async execute(input: { email: string; password: string }): Promise<LoginResult> {
    const account = await this.accounts.findByEmail(normalizeEmail(input.email));
    let valid = false;
    if (account) valid = await this.passwords.verify(account.passwordHash, input.password);
    else await this.passwords.verifyDummy(input.password);
    if (!account || !valid || !account.canLogin) {
      throw new UnauthenticatedError('The email or password is incorrect.', {
        code: ErrorCode.INVALID_CREDENTIALS,
      });
    }
    const access = await this.issuer.issue({ id: account.id, role: account.role });
    const token = this.generator.generate();
    const createdAt = this.clock.now();
    const record = {
      id: this.ids.next<'RefreshToken'>(),
      userId: account.id,
      tokenHash: token.hash,
      familyId: this.ids.next<'RefreshTokenFamily'>(),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000),
    };
    await this.refreshTokens.insert(record);
    await this.audit.record({
      action: 'refresh_token.issued',
      entityType: 'RefreshToken',
      entityId: record.id,
      after: {
        userId: record.userId,
        familyId: record.familyId,
        createdAt: createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
      },
    });
    return { ...access, refreshToken: token.raw, tokenType: 'Bearer' };
  }
}
