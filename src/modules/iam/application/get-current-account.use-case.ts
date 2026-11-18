import { Injectable } from '@nestjs/common';
import { UnauthenticatedError, type Id } from '../../../shared/kernel';
import type { UserAccount } from '../domain/user-account';
import { UserAccountRepository } from '../domain/user-account.repository';

/**
 * Reads the caller's account from the database, not from the token claims, so a role or
 * status changed by an admin shows at once.
 */
@Injectable()
export class GetCurrentAccount {
  constructor(private readonly accounts: UserAccountRepository) {}

  /** @throws UnauthenticatedError when the token's subject no longer has an account. */
  async execute(id: Id<'UserAccount'>): Promise<UserAccount> {
    const account = await this.accounts.findById(id);
    if (!account) throw new UnauthenticatedError('The account no longer exists.');
    return account;
  }
}
