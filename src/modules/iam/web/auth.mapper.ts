import type { UserAccount } from '../domain/user-account';
import type { AccountResponse } from './auth.schemas';

/** An allow-list prevents password hashes leaking through entity serialization. */
export function toAccountResponse(account: UserAccount): AccountResponse {
  return {
    id: account.id,
    email: account.email,
    role: account.role,
    status: account.status,
    version: account.version,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}
