import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectModuleDb } from '../../../platform/database/database';
import { asId } from '../../../shared/kernel';
import { UserAccount } from '../domain/user-account';
import { UserAccountRepository } from '../domain/user-account.repository';
import type { IamDb } from './persistence/iam-db';
import { userAccount } from './persistence/schema';

function toDomain(row: typeof userAccount.$inferSelect): UserAccount {
  return UserAccount.restore({
    id: asId<'UserAccount'>(row.id),
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
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
        deletedAt: account.deletedAt,
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
