import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import { InjectModuleDb } from '../../../platform/database/database';
import { updateWithVersion } from '../../../platform/database/versioning';
import {
  CLOCK,
  asId,
  pageOffset,
  toPage,
  type Clock,
  type Id,
  type Page,
} from '../../../shared/kernel';
import { isAccountStatus } from '../domain/account-status';
import { isRole } from '../domain/authenticated-user';
import type { LoginLockState } from '../domain/login-lockout';
import { UserAccount } from '../domain/user-account';
import { UserAccountRepository, type UserAccountQuery } from '../domain/user-account.repository';
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
    loginLock: { failedLoginCount: row.failedLoginCount, lockedUntil: row.lockedUntil },
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** Explicit credential mapping; no transaction is opened or passed by repositories. */
@Injectable()
export class DrizzleUserAccountRepository extends UserAccountRepository {
  constructor(
    // Public: `this` is the context of updateWithVersion.
    @InjectModuleDb() readonly db: IamDb,
    @Inject(CLOCK) readonly clock: Clock,
  ) {
    super();
  }

  async update(account: UserAccount, expectedVersion: number): Promise<UserAccount> {
    return toDomain(
      await updateWithVersion(this, userAccount, account.id, expectedVersion, {
        role: account.role,
        status: account.status,
      }),
    );
  }

  async list(query: UserAccountQuery): Promise<Page<UserAccount>> {
    const where = and(
      query.role === undefined ? undefined : eq(userAccount.role, query.role),
      query.status === undefined ? undefined : eq(userAccount.status, query.status),
    );
    const [rows, [counted]] = await Promise.all([
      this.db
        .select()
        .from(userAccount)
        .where(where)
        .orderBy(asc(userAccount.createdAt), asc(userAccount.id))
        .limit(query.size)
        .offset(pageOffset(query)),
      this.db.select({ total: count() }).from(userAccount).where(where),
    ]);
    return toPage(rows.map(toDomain), counted?.total ?? 0, query);
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
        failedLoginCount: account.loginLock.failedLoginCount,
        lockedUntil: account.loginLock.lockedUntil,
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

  async findByEmailForUpdate(email: string): Promise<UserAccount | undefined> {
    const [row] = await this.db
      .select()
      .from(userAccount)
      .where(eq(userAccount.email, email))
      .for('update');
    return row && toDomain(row);
  }

  /** Deliberately not updateWithVersion: login protection is not a client edit. */
  async saveLoginLock(id: Id<'UserAccount'>, state: LoginLockState): Promise<void> {
    await this.db
      .update(userAccount)
      .set({ failedLoginCount: state.failedLoginCount, lockedUntil: state.lockedUntil })
      .where(eq(userAccount.id, id));
  }

  async findById(id: Id<'UserAccount'>): Promise<UserAccount | undefined> {
    const row = await this.db.query.userAccount.findFirst({ where: eq(userAccount.id, id) });
    return row && toDomain(row);
  }
}
