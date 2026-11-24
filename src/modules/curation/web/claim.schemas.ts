import { z } from 'zod';

import { pageResponse, paginationQuery } from '../../../platform/http/pagination';
import { CLAIM_STATUSES, CLAIM_TYPES } from '../domain/claim-values';
import { REVIEW_QUEUE_STATUSES } from '../domain/claim.repository';

const claimType = z.enum(CLAIM_TYPES);

/** Body of every review action. The domain decides when a note is required. */
export const reviewClaimBody = z
  .strictObject({
    note: z.string().max(2000).optional(),
  })
  .optional();

export type ReviewClaimBody = z.infer<typeof reviewClaimBody>;

/** `GET /curation/queue`: oldest unverified (default) or disputed claims. */
export const reviewQueueQuery = paginationQuery.extend({
  status: z.enum(REVIEW_QUEUE_STATUSES).default('UNVERIFIED'),
  claimType: claimType.optional(),
  villageId: z.uuid().optional(),
});

export type ReviewQueueQueryParams = z.infer<typeof reviewQueueQuery>;

/** `GET /curation/conflicts`. */
export const conflictsQuery = paginationQuery.extend({
  claimType: claimType.optional(),
  villageId: z.uuid().optional(),
});

export type ConflictsQueryParams = z.infer<typeof conflictsQuery>;

/** The common fields of a claim and its review state; the typed value lives with its owner. */
export const claimResponse = z
  .strictObject({
    id: z.uuid(),
    claimType,
    villageId: z.uuid(),
    groupKey: z.string(),
    valueHash: z.string(),
    sourceId: z.uuid().nullable(),
    sourceLocator: z.string().nullable(),
    status: z.enum(CLAIM_STATUSES),
    isPreferred: z.boolean(),
    supersedesId: z.uuid().nullable(),
    createdBy: z.uuid(),
    reviewedBy: z.uuid().nullable(),
    reviewedAt: z.iso.datetime().nullable(),
    reviewNote: z.string().nullable(),
    version: z.int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'ClaimResponse' });

export type ClaimResponse = z.infer<typeof claimResponse>;

export const claimPageResponse = pageResponse(claimResponse).meta({ id: 'ClaimPage' });

/** A question whose live claims disagree, computed on every read. */
export const claimConflictResponse = z
  .strictObject({
    groupKey: z.string(),
    villageId: z.uuid(),
    claimType,
    distinctValues: z.int().min(2),
    claimCount: z.int().min(2),
    claimIds: z.array(z.uuid()),
  })
  .meta({ id: 'ClaimConflict' });

export type ClaimConflictResponse = z.infer<typeof claimConflictResponse>;

export const claimConflictPageResponse = pageResponse(claimConflictResponse).meta({
  id: 'ClaimConflictPage',
});
