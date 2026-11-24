import type { Claim } from '../domain/claim';
import type { ClaimConflict } from '../domain/claim.repository';
import type { ClaimConflictResponse, ClaimResponse } from './claim.schemas';

/** Converts a claim into its explicit API response DTO. */
export function toClaimResponse(claim: Claim): ClaimResponse {
  const data = claim.data;

  return {
    id: claim.id,
    claimType: data.claimType,
    villageId: data.villageId,
    groupKey: data.groupKey,
    valueHash: data.valueHash,
    sourceId: data.sourceId,
    sourceLocator: data.sourceLocator,
    status: data.status,
    isPreferred: data.isPreferred,
    supersedesId: data.supersedesId,
    createdBy: claim.createdBy,
    reviewedBy: data.reviewedBy,
    reviewedAt: data.reviewedAt?.toISOString() ?? null,
    reviewNote: data.reviewNote,
    version: claim.version,
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString(),
  };
}

/** Converts a computed conflict into its API response DTO. */
export function toClaimConflictResponse(conflict: ClaimConflict): ClaimConflictResponse {
  return { ...conflict, claimIds: [...conflict.claimIds] };
}
