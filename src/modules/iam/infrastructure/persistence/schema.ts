import {
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

/**
 * IAM-owned credentials; email remains reserved even when an account is disabled.
 * Role and status are plain text: their allowed values live in the domain, and the
 * repository rejects an unknown value read back from the database.
 */
export const userAccount = pgTable(
  'user_account',
  {
    id: uuid().primaryKey(),
    email: citext().notNull(),
    passwordHash: text().notNull(),
    role: text().notNull().default(Role.CONTRIBUTOR),
    status: text().notNull().default(AccountStatus.ACTIVE),
    ...versionColumns(),
  },
  (table) => [uniqueIndex('user_account_email_key').on(table.email)],
);

/**
 * Only SHA-256 digests are persisted. A row is revoked once (`revokedAt`); a rotated row
 * points at its successor (`replacedById`) in the same family. The digest format and
 * expiry rules are domain rules (refresh-token-rules.ts), not CHECKs.
 */
export const refreshToken = pgTable(
  'refresh_token',
  {
    id: uuid().primaryKey(),
    userId: uuid().notNull(),
    tokenHash: text().notNull(),
    familyId: uuid().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    replacedById: uuid(),
  },
  (table) => [
    foreignKey({
      name: 'refresh_token_user_id_fk',
      columns: [table.userId],
      foreignColumns: [userAccount.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'refresh_token_replaced_by_id_fk',
      columns: [table.replacedById],
      foreignColumns: [table.id],
    }).onDelete('restrict'),
    uniqueIndex('refresh_token_token_hash_key').on(table.tokenHash),
    index('refresh_token_user_id_idx').on(table.userId),
    index('refresh_token_family_id_idx').on(table.familyId),
    index('refresh_token_replaced_by_id_idx').on(table.replacedById),
  ],
);
