import { Injectable } from '@nestjs/common';
import type { ClaimType } from '../domain/claim-values';

/** A change of the published (preferred) answer of one question. */
export interface PreferredClaimChange {
  villageId: string;
  groupKey: string;
  /** The claim that is now preferred, or null when the question has no published answer. */
  newPreferredClaimId: string | null;
  /** The claim that was preferred before, or null when there was none. */
  previousPreferredClaimId: string | null;
}

/**
 * What an owning module tells curation about one of its claim types. Owners
 * (village, population, heritage, economy) register a handler in their
 * `onModuleInit`; curation never imports them (ADR-003).
 */
export interface ClaimTypeHandler {
  claimType: ClaimType;
  /**
   * Updates the owner's projections after the preferred claim of a question
   * changed. Runs **inside the review transaction**: throwing rolls the whole
   * review back, so a projection never disagrees with its preferred claim.
   */
  onPreferredChanged?(change: PreferredClaimChange): Promise<void>;
}

/**
 * Registry of the claim types owning modules handle. One handler per claim
 * type; a type without a handler has no projection to keep up to date.
 */
@Injectable()
export class ClaimTypeRegistry {
  private readonly handlers = new Map<ClaimType, ClaimTypeHandler>();

  /** Registers the handler of a claim type. A second handler for the same type is a wiring bug. */
  register(handler: ClaimTypeHandler): void {
    if (this.handlers.has(handler.claimType)) {
      throw new Error(`A handler for claim type ${handler.claimType} is already registered.`);
    }

    this.handlers.set(handler.claimType, handler);
  }

  /** The handler of `claimType`, if its owner registered one. */
  handlerFor(claimType: ClaimType): ClaimTypeHandler | undefined {
    return this.handlers.get(claimType);
  }

  /** Runs the owner's projection hook in the caller's transaction; no-op without one. */
  async notifyPreferredChanged(claimType: ClaimType, change: PreferredClaimChange): Promise<void> {
    await this.handlers.get(claimType)?.onPreferredChanged?.(change);
  }
}
