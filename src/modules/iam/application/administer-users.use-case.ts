import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  AUDIT_RECORDER,
  CLOCK,
  NotFoundError,
  asId,
  type AuditRecorder,
  type Clock,
  type Page,
} from '../../../shared/kernel';
import { assertNotSelf } from '../domain/account-administration';
import type { AccountStatus } from '../domain/account-status';
import type { Role } from '../domain/authenticated-user';
import type { UserAccount } from '../domain/user-account';
import { RefreshTokenRepository } from '../domain/refresh-token.repository';
import { UserAccountRepository, type UserAccountQuery } from '../domain/user-account.repository';

/** One admin change: who asks, which account, at which version. */
export interface AccountChange {
  actorId: string;
  accountId: string;
  expectedVersion: number;
}

/** `GET /users` (#32): the admin's account list. */
@Injectable()
export class ListUsers {
  constructor(private readonly accounts: UserAccountRepository) {}

  execute(query: UserAccountQuery): Promise<Page<UserAccount>> {
    return this.accounts.list(query);
  }
}

/**
 * Role and status changes by an administrator (#32).
 *
 * Each change, in one transaction:
 * 1. refuses a change of the caller's own account (422, domain rule);
 * 2. stores it with optimistic locking (404 / 412);
 * 3. revokes **every** refresh-token family of the account, so the user must log
 *    in again and gets a token with the new role, or cannot log in when disabled;
 * 4. audits the change with the role and status before and after, and how many
 *    tokens were revoked.
 *
 * Access tokens already issued stay valid until they expire (at most
 * `JWT_ACCESS_TTL`, 15 minutes): the JWT guard does not read the database on every
 * request (#10). That is the accepted window; `/auth/me` already shows the change.
 */
@Injectable()
export class ChangeUserAccess {
  constructor(
    private readonly accounts: UserAccountRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
  ) {}

  @Transactional()
  changeRole(change: AccountChange & { role: Role }): Promise<UserAccount> {
    return this.apply(change, 'user_account.role_changed', (account) =>
      account.withRole(change.role),
    );
  }

  @Transactional()
  changeStatus(change: AccountChange & { status: AccountStatus }): Promise<UserAccount> {
    return this.apply(change, 'user_account.status_changed', (account) =>
      account.withStatus(change.status),
    );
  }

  private async apply(
    change: AccountChange,
    action: string,
    modify: (account: UserAccount) => UserAccount,
  ): Promise<UserAccount> {
    assertNotSelf(change.actorId, change.accountId);
    const id = asId<'UserAccount'>(change.accountId);
    const before = await this.accounts.findById(id);
    if (!before) throw new NotFoundError(`User ${change.accountId} does not exist.`);
    const after = await this.accounts.update(modify(before), change.expectedVersion);
    const revokedCount = await this.refreshTokens.revokeAllForUser(id, this.clock.now());
    await this.audit.record({
      action,
      entityType: 'UserAccount',
      entityId: id,
      // Only what an admin can change, never the email (the trail is never purged).
      before: { role: before.role, status: before.status },
      after: { role: after.role, status: after.status, revokedCount },
    });
    return after;
  }
}
