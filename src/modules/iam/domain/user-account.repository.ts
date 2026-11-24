import type { Id, Page, PageRequest } from '../../../shared/kernel';
import type { AccountStatus } from './account-status';
import type { Role } from './authenticated-user';
import type { LoginLockState } from './login-lockout';
import type { UserAccount } from './user-account';

/** Filters of the admin account list (#32). */
export interface UserAccountQuery extends PageRequest {
  role?: Role;
  status?: AccountStatus;
}

/** Account storage contract; lookups include disabled accounts for uniform verification. */
export abstract class UserAccountRepository {
  abstract insert(account: UserAccount): Promise<UserAccount>;
  abstract findByEmail(email: string): Promise<UserAccount | undefined>;
  /**
   * Like {@link findByEmail}, but locks the row (`SELECT ... FOR UPDATE`) until the
   * transaction ends, so concurrent logins to one account count failures one by one.
   */
  abstract findByEmailForUpdate(email: string): Promise<UserAccount | undefined>;
  /** Stores the failed-login counter and lock; the account's version does not change. */
  abstract saveLoginLock(id: Id<'UserAccount'>, state: LoginLockState): Promise<void>;
  /**
   * Stores a changed role or status if the account is still at `expectedVersion`.
   *
   * @throws NotFoundError (404) when the account does not exist
   * @throws PreconditionFailedError (412) when it changed since that version
   */
  abstract update(account: UserAccount, expectedVersion: number): Promise<UserAccount>;
  /** Accounts by creation time (oldest first), optionally filtered by role and status. */
  abstract list(query: UserAccountQuery): Promise<Page<UserAccount>>;
  /** Reads the current stored account, so role and status changes are visible at once. */
  abstract findById(id: Id<'UserAccount'>): Promise<UserAccount | undefined>;
}
