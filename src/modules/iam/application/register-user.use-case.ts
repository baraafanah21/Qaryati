import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  AUDIT_RECORDER,
  CLOCK,
  ID_GENERATOR,
  type AuditRecorder,
  type Clock,
  type IdGenerator,
} from '../../../shared/kernel';
import { normalizeEmail } from '../domain/email';
import { validatePassword } from '../domain/password-policy';
import { UserAccount } from '../domain/user-account';
import { UserAccountRepository } from '../domain/user-account.repository';
import { PasswordHasher } from './password-hasher';

/** Registration stores only a password hash and audits the account in the same transaction. */
@Injectable()
export class RegisterUser {
  constructor(
    private readonly accounts: UserAccountRepository,
    private readonly passwords: PasswordHasher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
  ) {}

  @Transactional()
  async execute(input: { email: string; password: string }): Promise<UserAccount> {
    const email = normalizeEmail(input.email);
    validatePassword(input.password);
    const passwordHash = await this.passwords.hash(input.password);
    const account = await this.accounts.insert(
      UserAccount.create({
        id: this.ids.next<'UserAccount'>(),
        email,
        passwordHash,
        now: this.clock.now(),
      }),
    );
    await this.audit.record({
      action: 'user_account.created',
      entityType: 'UserAccount',
      entityId: account.id,
      after: account.snapshot(),
    });
    return account;
  }
}
