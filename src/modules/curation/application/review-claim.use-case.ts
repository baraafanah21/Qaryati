import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';

import {
  AUDIT_RECORDER,
  CLOCK,
  ConflictError,
  ErrorCode,
  NotFoundError,
  PreconditionFailedError,
  type AuditRecorder,
  type Clock,
  type Id,
} from '../../../shared/kernel';

import type { Claim } from '../domain/claim';
import {
  decidePreference,
  REVIEW_TARGET_STATUS,
  type ReviewAction,
} from '../domain/claim-preference';
import { CLAIM_REPOSITORY, type ClaimRepository } from '../domain/claim.repository';

import { ClaimTypeRegistry } from './claim-type-registry';

/** Audit action of each review action. */
const AUDIT_ACTIONS = {
  VERIFY: 'claim.verified',
  DISPUTE: 'claim.disputed',
  REJECT: 'claim.rejected',
  PREFER: 'claim.preferred',
} as const satisfies Record<ReviewAction, string>;

/** Input of one review action, already authenticated and authorised (EDITOR+). */
export interface ReviewClaimInput {
  id: Id<'Claim'>;
  expectedVersion: number;
  action: ReviewAction;
  reviewerId: string;
  note?: string | null;
}

/**
 * Verifies, disputes, rejects or prefers a claim, moves the preferred flag of
 * its question and runs the owner's projection hook, all in one transaction.
 *
 * Concurrency: the old preferred claim is cleared with the version read
 * before, and the new flag is guarded by the unique index
 * `claim_one_preferred`. Of two editors preferring different claims of one
 * question at once, exactly one commits; the other gets 409 VERSION_CONFLICT.
 */
@Injectable()
export class ReviewClaim {
  constructor(
    @Inject(CLAIM_REPOSITORY)
    private readonly claims: ClaimRepository,
    private readonly registry: ClaimTypeRegistry,
    @Inject(AUDIT_RECORDER)
    private readonly audit: AuditRecorder,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  @Transactional()
  async execute(input: ReviewClaimInput): Promise<Claim> {
    const current = await this.claims.findById(input.id);

    if (!current) {
      throw new NotFoundError(`Claim ${input.id} does not exist.`);
    }

    // A stale ETag fails before any rule runs, like every other versioned write.
    if (current.version !== input.expectedVersion) {
      throw new PreconditionFailedError(
        `The claim ${input.id} is at version ${current.version}, not ${input.expectedVersion}. ` +
          'Read it again and retry with the new ETag.',
        { details: { currentVersion: current.version } },
      );
    }

    const { groupKey, villageId, claimType } = current.data;
    const note = input.note?.trim() || null;

    // Status change first: Claim.review enforces four eyes, transitions,
    // the source on verify and the note on dispute and reject.
    const reviewed =
      input.action === 'PREFER'
        ? current
        : current.review({
            reviewerId: input.reviewerId,
            status: REVIEW_TARGET_STATUS[input.action],
            note,
            now: this.clock.now(),
          });

    const preferred = await this.claims.findPreferredForGroup(groupKey);
    const decision = decidePreference({
      action: input.action,
      claimId: current.id,
      status: current.status,
      wasPreferred: current.isPreferred,
      currentPreferredId: preferred?.id ?? null,
    });

    // Old flag first: the partial unique index allows one preferred claim per question.
    if (decision.clearPreviousId !== null && preferred) {
      await this.clearPreviousPreferred(preferred);
    }

    const next = decision.makePreferred ? reviewed.markPreferred() : reviewed;
    const stored =
      next === current ? current : await this.claims.update(next, input.expectedVersion);

    if (decision.change) {
      await this.registry.notifyPreferredChanged(claimType, {
        villageId,
        groupKey,
        ...decision.change,
      });
    }

    if (stored !== current) {
      await this.audit.record({
        action: AUDIT_ACTIONS[input.action],
        entityType: 'Claim',
        entityId: stored.id,
        villageId,
        before: current.snapshot(),
        after: {
          ...stored.snapshot(),
          ...(decision.change
            ? { previousPreferredClaimId: decision.change.previousPreferredClaimId }
            : {}),
          ...(input.action === 'PREFER' && note ? { preferenceNote: note } : {}),
        },
      });
    }

    return stored;
  }

  /**
   * Clears the old preferred claim with the version read in this request. If
   * another editor changed it meanwhile, this request lost the race.
   */
  private async clearPreviousPreferred(previous: Claim): Promise<void> {
    try {
      await this.claims.update(previous.clearPreferred(), previous.version);
    } catch (error) {
      if (error instanceof PreconditionFailedError) {
        throw new ConflictError(
          'The preferred claim of this question changed at the same time. Reload and retry.',
          { code: ErrorCode.VERSION_CONFLICT, cause: error },
        );
      }

      throw error;
    }
  }
}
