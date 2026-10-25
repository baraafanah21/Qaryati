import type { UserAccount } from './user-account';

/** Account storage contract; lookups include disabled/deleted accounts for uniform verification. */
export abstract class UserAccountRepository {
  abstract insert(account: UserAccount): Promise<UserAccount>;
  abstract findByEmail(email: string): Promise<UserAccount | undefined>;
}
