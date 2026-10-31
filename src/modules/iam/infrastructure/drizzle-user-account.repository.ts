import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectModuleDb } from '../../../platform/database/database';
import { asId } from '../../../shared/kernel';
import { isAccountStatus } from '../domain/account-status';
import { isRole } from '../domain/authenticated-user';
import { UserAccount } from '../domain/user-account';
import { UserAccountRepository } from '../domain/user-account.repository';
import type { IamDb } from './persistence/iam-db';
import { userAccount } from './persistence/schema';

/**
 * Role and status are plain text in the database (no CHECK), so an unknown
 * value is a data error: it fails loudly (500) instead of reaching the domain.
 */
function toDomain(row: typeof userAccount.$inferSelect): UserAccount {
  const { role, status } = row;
  if (!isRole(role)) throw new Error(`user_account ${row.id} has an unknown role.`);
  if (!isAccountStatus(status)) throw new Error(`user_account ${row.id} has an unknown status.`);
  return UserAccount.restore({
    id: asId<'UserAccount'>(row.id),
    email: row.email,
    passwordHash: row.passwordHash,
    role,
    status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** Explicit credential mapping; no transaction is opened or passed by repositories. */
@Injectable()
export class DrizzleUserAccountRepository extends UserAccountRepository {
  constructor(@InjectModuleDb() private readonly db: IamDb) {
    super();
  }

  async insert(account: UserAccount): Promise<UserAccount> {
    const [row] = await this.db
      .insert(userAccount)
      .values({
        id: account.id,
        email: account.email,
        passwordHash: account.passwordHash,
        role: account.role,
        status: account.status,
        version: account.version,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      })
      .returning();
    if (!row) throw new Error('Account insertion returned no row.');
    return toDomain(row);
  }

  async findByEmail(email: string): Promise<UserAccount | undefined> {
    const row = await this.db.query.userAccount.findFirst({ where: eq(userAccount.email, email) });
    return row && toDomain(row);
  }
}
