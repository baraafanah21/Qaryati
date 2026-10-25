import type { Id } from '../../../shared/kernel';

/** Persistable issuance facts; the raw credential is intentionally absent. */
export interface RefreshTokenRecord {
  id: Id<'RefreshToken'>;
  userId: Id<'UserAccount'>;
  tokenHash: string;
  familyId: Id<'RefreshTokenFamily'>;
  createdAt: Date;
  expiresAt: Date;
}

/** #14 only issues credentials; consuming or revoking them belongs to #18. */
export abstract class RefreshTokenRepository {
  abstract insert(record: RefreshTokenRecord): Promise<void>;
}
