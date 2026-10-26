import { Injectable } from '@nestjs/common';
import { InjectModuleDb } from '../../../platform/database/database';
import {
  RefreshTokenRepository,
  type RefreshTokenRecord,
} from '../domain/refresh-token.repository';
import type { IamDb } from './persistence/iam-db';
import { refreshToken } from './persistence/schema';

/** Persists the digest only; this adapter cannot consume or revoke tokens. */
@Injectable()
export class DrizzleRefreshTokenRepository extends RefreshTokenRepository {
  constructor(@InjectModuleDb() private readonly db: IamDb) {
    super();
  }
  async insert(record: RefreshTokenRecord): Promise<void> {
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
