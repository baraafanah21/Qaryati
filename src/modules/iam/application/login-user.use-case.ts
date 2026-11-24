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
import { UNLOCKED, afterFailedLogin, isLocked, needsReset } from '../domain/login-lockout';
import { refreshTokenExpiry } from '../domain/refresh-decision';
import { RefreshTokenRepository } from '../domain/refresh-token.repository';
import type { UserAccount } from '../domain/user-account';
import { UserAccountRepository } from '../domain/user-account.repository';
import { AccessTokenIssuer } from './access-token-issuer';
import { PasswordHasher } from './password-hasher';
import { RefreshTokenGenerator } from './refresh-token-generator';
import { RefreshTokenLifetime } from './refresh-token-lifetime';

/** Login response; credentials must never be placed in logs or audit payloads. */
export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

/**
 * A successful login starts a new refresh-token family with one hashed token.
 *
 * **Lockout (#25).** Every failed password on an existing account is counted; the
 * 10th in a row locks the account for 15 minutes (domain/login-lockout.ts). A
 * locked account answers exactly like a wrong password, even when the password is
 * right, so the response never tells an attacker that an account exists or is
 * locked. The password is still verified while locked, so timing does not tell
 * either.
 *
 * The counter must survive the 401. The decision and its writes therefore run in
 * {@link LoginUser.attempt}, its own transaction, which returns instead of
 * throwing; `execute` throws only after that transaction committed (the same
 * pattern as RefreshSession). The account row is read `FOR UPDATE`, so concurrent
 * attempts on one account are counted one after the other.
 */
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
    private readonly lifetime: RefreshTokenLifetime,
  ) {}

  /** @throws UnauthenticatedError INVALID_CREDENTIALS for every rejected attempt. */
  async execute(input: { email: string; password: string }): Promise<LoginResult> {
    const result = await this.attempt(input);
    if (!result) {
      throw new UnauthenticatedError('The email or password is incorrect.', {
        code: ErrorCode.INVALID_CREDENTIALS,
      });
    }
    return result;
  }

  /** Decides and writes in one transaction; `undefined` means "reject" (after commit). */
  @Transactional()
  async attempt(input: { email: string; password: string }): Promise<LoginResult | undefined> {
    const now = this.clock.now();
    const account = await this.accounts.findByEmailForUpdate(normalizeEmail(input.email));
    if (!account) {
      await this.passwords.verifyDummy(input.password);
      return undefined;
    }
    const valid = await this.passwords.verify(account.passwordHash, input.password);
    if (isLocked(account.loginLock, now) || !account.canLogin) return undefined;
    if (!valid) {
      await this.recordFailure(account, now);
      return undefined;
    }
    if (needsReset(account.loginLock)) await this.accounts.saveLoginLock(account.id, UNLOCKED);
    return this.issueSession(account, now);
  }

  private async recordFailure(account: UserAccount, now: Date): Promise<void> {
    const { state, locked } = afterFailedLogin(account.loginLock, now);
    await this.accounts.saveLoginLock(account.id, state);
    if (!locked) return;
    await this.audit.record({
      action: 'account.locked',
      entityType: 'UserAccount',
      entityId: account.id,
      after: { lockedUntil: state.lockedUntil?.toISOString() },
    });
  }

  private async issueSession(account: UserAccount, createdAt: Date): Promise<LoginResult> {
    const access = await this.issuer.issue({ id: account.id, role: account.role });
    const token = this.generator.generate();
    const record = {
      id: this.ids.next<'RefreshToken'>(),
      userId: account.id,
      tokenHash: token.hash,
      familyId: this.ids.next<'RefreshTokenFamily'>(),
      createdAt,
      expiresAt: refreshTokenExpiry(createdAt, this.lifetime.seconds),
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
