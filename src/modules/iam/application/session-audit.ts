import type { AuditRecorder, Id } from '../../../shared/kernel';

/** Audit entity type of a refresh-token family; its id is the family id. */
export const REFRESH_TOKEN_FAMILY = 'RefreshTokenFamily';

/** Why a family was revoked; recorded in `session.revoked` entries. */
export type SessionRevocationReason = 'LOGOUT' | 'USER_INACTIVE';

/**
 * Records a family revocation. Snapshots carry the owner, the reason and the count of
 * tokens revoked, never a token value or digest.
 */
export function recordFamilyRevocation(
  audit: AuditRecorder,
  action: 'session.revoked' | 'session.reuse_detected',
  family: { familyId: Id<'RefreshTokenFamily'>; userId: Id<'UserAccount'> },
  details: { revokedCount: number; reason?: SessionRevocationReason },
): Promise<void> {
  return audit.record({
    action,
    entityType: REFRESH_TOKEN_FAMILY,
    entityId: family.familyId,
    after: { userId: family.userId, ...details },
  });
}
