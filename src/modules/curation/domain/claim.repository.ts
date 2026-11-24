import type { Id, Page, PageRequest } from '../../../shared/kernel';
import type { Claim } from './claim';
import type { ClaimType } from './claim-values';

/** Statuses the review queue lists (the partial index `claim_review_queue` covers them). */
export const REVIEW_QUEUE_STATUSES = ['UNVERIFIED', 'DISPUTED'] as const;

export type ReviewQueueStatus = (typeof REVIEW_QUEUE_STATUSES)[number];

/** Filters of the review queue, oldest claim first. */
export interface ReviewQueueQuery extends PageRequest {
  status: ReviewQueueStatus;
  claimType?: ClaimType;
  villageId?: string;
}

/** Filters of the conflicts list. */
export interface ConflictQuery extends PageRequest {
  claimType?: ClaimType;
  villageId?: string;
}

/**
 * A question whose live claims (unverified, verified or disputed) disagree:
 * computed on every read, never stored (docs/data-model.md).
 */
export interface ClaimConflict {
  groupKey: string;
  villageId: string;
  claimType: ClaimType;
  distinctValues: number;
  claimCount: number;
  /** Ids of the live claims, oldest first. */
  claimIds: string[];
}

/**
 * Persistence port for claims.
 * All writes participate in the caller's transaction.
 */
export interface ClaimRepository {
  /** Inserts a claim and returns the persisted record. */
  insert(claim: Claim): Promise<Claim>;

  /** Finds a claim by its identifier. */
  findById(id: Id<'Claim'>): Promise<Claim | undefined>;

  /**
   * Updates a claim using optimistic locking.
   * Throws NotFoundError or PreconditionFailedError when appropriate, and a
   * ConflictError (VERSION_CONFLICT) when another claim of the question became
   * preferred concurrently (unique index `claim_one_preferred`).
   */
  update(claim: Claim, expectedVersion: number): Promise<Claim>;

  /** Whether the question `groupKey` has a preferred (published) claim. */
  hasPreferredForGroup(groupKey: string): Promise<boolean>;

  /** The preferred claim of the question `groupKey`, if any. */
  findPreferredForGroup(groupKey: string): Promise<Claim | undefined>;

  /** Claims waiting for review, oldest first (native SQL on `claim_review_queue`). */
  listReviewQueue(query: ReviewQueueQuery): Promise<Page<Claim>>;

  /** Questions with more than one distinct value among live claims. */
  listConflicts(query: ConflictQuery): Promise<Page<ClaimConflict>>;
}

/** Injection token for the claim repository. */
export const CLAIM_REPOSITORY = Symbol('CLAIM_REPOSITORY');
