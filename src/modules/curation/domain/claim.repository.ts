import type { Id } from '../../../shared/kernel';
import type { Claim } from './claim';

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
   * Throws NotFoundError or PreconditionFailedError when appropriate.
   */
  update(claim: Claim, expectedVersion: number): Promise<Claim>;

  /** Whether the question `groupKey` has a preferred (published) claim. */
  hasPreferredForGroup(groupKey: string): Promise<boolean>;
}

/** Injection token for the claim repository. */
export const CLAIM_REPOSITORY = Symbol('CLAIM_REPOSITORY');
