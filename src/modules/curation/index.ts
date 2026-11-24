/**
 * Public API of the curation module.
 * Other modules must import curation services from this entry point.
 */

// Source API — Issue #13
export { SourceQueries } from './application/source-queries';
export { SOURCE_TYPES } from './domain/source-values';
export type { SourceType } from './domain/source-values';

// Claims API — Issue #16
export { ClaimWriter } from './application/claim-writer';
export { ClaimQueries, type ClaimView } from './application/claim-queries';
export type { SubmitClaimInput, EditClaimInput, FactSnapshot } from './application/claim-writer';
export type { ClaimProvenance } from './domain/claim.repository';

// Claim review — Issue #35: owners register their claim types and projection hooks.
export { ClaimTypeRegistry } from './application/claim-type-registry';
export type { ClaimTypeHandler, PreferredClaimChange } from './application/claim-type-registry';

// Village search (#30): the preferred claims of one type as a derived table for owners' native SQL.
export { preferredClaimsOf } from './infrastructure/preferred-claims.sql';
// Population (#28): every claim of one type, for an owner's native SQL with its own order.
export { claimsOf } from './infrastructure/preferred-claims.sql';

export {
  CLAIM_GROUP_PREFIXES,
  CLAIM_TYPES,
  CLAIM_STATUSES,
  SOURCE_REQUIRED_ON_SUBMIT,
} from './domain/claim-values';

export type { ClaimType, ClaimStatus } from './domain/claim-values';

export { buildGroupKey } from './domain/group-key';
export { valueHash, roundCoordinate } from './domain/value-hash';
