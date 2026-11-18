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

/** A stored refresh token with its lifecycle: revoked once, and replaced when it was rotated. */
export interface StoredRefreshToken extends RefreshTokenRecord {
  revokedAt: Date | null;
  replacedById: Id<'RefreshToken'> | null;
}

/**
 * Refresh-token storage. The adapter reads and writes only: expiry, revocation and
 * account status are decided by `decideRefresh` in the domain, never in SQL.
 */
export abstract class RefreshTokenRepository {
  /** Inserts a new, unrevoked token after checking the domain rules. */
  abstract insert(record: RefreshTokenRecord): Promise<void>;

  /**
   * Finds a token by its digest and locks the row (`SELECT ... FOR UPDATE`) until the
   * transaction ends, so two concurrent uses of one token are decided one after the other.
   */
  abstract findByHashForUpdate(tokenHash: string): Promise<StoredRefreshToken | undefined>;

  /** Records that `id` was rotated: revoked at `revokedAt` and replaced by `replacedById`. */
  abstract markRotated(
    id: Id<'RefreshToken'>,
    revokedAt: Date,
    replacedById: Id<'RefreshToken'>,
  ): Promise<void>;

  /**
   * Revokes every still-active token of a family.
   *
   * @returns the number of tokens revoked by this call (0 when the family was already revoked).
   */
  abstract revokeFamily(familyId: Id<'RefreshTokenFamily'>, revokedAt: Date): Promise<number>;
}
