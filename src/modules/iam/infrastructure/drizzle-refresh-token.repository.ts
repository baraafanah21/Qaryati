import { Injectable } from '@nestjs/common';
import { InjectModuleDb } from '../../../platform/database/database';
import { assertValidRefreshTokenRecord } from '../domain/refresh-token-rules';
import {
  RefreshTokenRepository,
  type RefreshTokenRecord,
} from '../domain/refresh-token.repository';
import type { IamDb } from './persistence/iam-db';
import { refreshToken } from './persistence/schema';

/**
 * Persists the digest only; this adapter cannot consume or revoke tokens.
 * Every row passes the domain rules first: the database has no CHECK for them.
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
}
