import type { Id } from '../../../shared/kernel';
import type { UserAccount } from './user-account';

/** Account storage contract; lookups include disabled accounts for uniform verification. */
export abstract class UserAccountRepository {
  abstract insert(account: UserAccount): Promise<UserAccount>;
  abstract findByEmail(email: string): Promise<UserAccount | undefined>;
  /** Reads the current stored account, so role and status changes are visible at once. */
  abstract findById(id: Id<'UserAccount'>): Promise<UserAccount | undefined>;
}
