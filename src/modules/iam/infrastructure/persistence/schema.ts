import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { versionColumns } from '../../../../platform/database/versioning';
import { AccountStatus } from '../../domain/account-status';
import { Role } from '../../domain/authenticated-user';

// The baseline migration already enables citext; uniqueness must also hold for concurrent writes.
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/** IAM-owned credentials; email remains reserved even when an account is disabled or deleted. */
export const userAccount = pgTable(
  'user_account',
  {
    id: uuid().primaryKey(),
    email: citext().notNull(),
    passwordHash: text().notNull(),
    role: text().$type<Role>().notNull().default(Role.CONTRIBUTOR),
    status: text().$type<AccountStatus>().notNull().default(AccountStatus.ACTIVE),
    ...versionColumns(),
  },
  (table) => [
    uniqueIndex('user_account_email_key').on(table.email),
    check('user_account_role_check', sql`${table.role} IN ('CONTRIBUTOR', 'EDITOR', 'ADMIN')`),
    check('user_account_status_check', sql`${table.status} IN ('ACTIVE', 'DISABLED')`),
    check('user_account_version_check', sql`${table.version} >= 1`),
  ],
);

/** Only SHA-256 digests are persisted; family identity prepares for #18 without rotation behavior. */
export const refreshToken = pgTable(
  'refresh_token',
  {
    id: uuid().primaryKey(),
    userId: uuid().notNull(),
    tokenHash: text().notNull(),
    familyId: uuid().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      name: 'refresh_token_user_id_fk',
      columns: [table.userId],
      foreignColumns: [userAccount.id],
    }).onDelete('restrict'),
    uniqueIndex('refresh_token_token_hash_key').on(table.tokenHash),
    index('refresh_token_user_id_idx').on(table.userId),
    check('refresh_token_token_hash_check', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('refresh_token_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);
