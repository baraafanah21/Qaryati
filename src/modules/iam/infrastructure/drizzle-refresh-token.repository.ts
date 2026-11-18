import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { InjectModuleDb } from '../../../platform/database/database';
import { asId, type Id } from '../../../shared/kernel';
import { assertValidRefreshTokenRecord } from '../domain/refresh-token-rules';
import {
  RefreshTokenRepository,
  type RefreshTokenRecord,
  type StoredRefreshToken,
} from '../domain/refresh-token.repository';
import type { IamDb } from './persistence/iam-db';
import { refreshToken } from './persistence/schema';

function toStored(row: typeof refreshToken.$inferSelect): StoredRefreshToken {
  return {
    id: asId<'RefreshToken'>(row.id),
    userId: asId<'UserAccount'>(row.userId),
    tokenHash: row.tokenHash,
    familyId: asId<'RefreshTokenFamily'>(row.familyId),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    replacedById: row.replacedById === null ? null : asId<'RefreshToken'>(row.replacedById),
  };
}

/**
 * Reads and writes only. Expiry, revocation and account status are decided in the domain
 * (`decideRefresh`); the one condition kept in SQL is "still active" when a family is
 * revoked, so that the returned count means "revoked by this call".
 * Every inserted row passes the domain rules first: the database has no CHECK for them.
 */
@Injectable()
export class DrizzleRefreshTokenRepository extends RefreshTokenRepository {
  constructor(@InjectModuleDb() private readonly db: IamDb) {
    super();
  }

  async insert(record: RefreshTokenRecord): Promise<void> {
    assertValidRefreshTokenRecord(record);
    await this.db.insert(refreshToken).values({
      id: record.id,
      userId: record.userId,
      tokenHash: record.tokenHash,
      familyId: record.familyId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    });
  }

  async findByHashForUpdate(tokenHash: string): Promise<StoredRefreshToken | undefined> {
    const [row] = await this.db
      .select()
      .from(refreshToken)
      .where(eq(refreshToken.tokenHash, tokenHash))
      .for('update');
    return row && toStored(row);
  }

  async markRotated(
    id: Id<'RefreshToken'>,
    revokedAt: Date,
    replacedById: Id<'RefreshToken'>,
  ): Promise<void> {
    await this.db
      .update(refreshToken)
      .set({ revokedAt, replacedById })
      .where(eq(refreshToken.id, id));
  }

  async revokeFamily(familyId: Id<'RefreshTokenFamily'>, revokedAt: Date): Promise<number> {
    const revoked = await this.db
      .update(refreshToken)
      .set({ revokedAt })
      .where(and(eq(refreshToken.familyId, familyId), isNull(refreshToken.revokedAt)))
      .returning({ id: refreshToken.id });
    return revoked.length;
  }
}
