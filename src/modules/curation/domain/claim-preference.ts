import { BusinessRuleViolationError } from '../../../shared/kernel';
import type { ClaimStatus } from './claim-values';

/** The four review actions an editor can take on a claim. */
export const REVIEW_ACTIONS = ['VERIFY', 'DISPUTE', 'REJECT', 'PREFER'] as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** Whether `value` is one of {@link REVIEW_ACTIONS}. */
export function isReviewAction(value: unknown): value is ReviewAction {
  return typeof value === 'string' && (REVIEW_ACTIONS as readonly string[]).includes(value);
}

/** The status a status-changing review action leads to. */
export const REVIEW_TARGET_STATUS = {
  VERIFY: 'VERIFIED',
  DISPUTE: 'DISPUTED',
  REJECT: 'REJECTED',
} as const satisfies Record<Exclude<ReviewAction, 'PREFER'>, ClaimStatus>;

/** What a review action does to the preferred claim of the question. */
export interface PreferenceDecision {
  /** The claim reviewed becomes the preferred (published) answer. */
  makePreferred: boolean;
  /** The previous preferred claim (another claim of the question) loses the flag first. */
  clearPreviousId: string | null;
  /** The change owners must project, or null when the published answer is unchanged. */
  change: { newPreferredClaimId: string | null; previousPreferredClaimId: string | null } | null;
}

const UNCHANGED: PreferenceDecision = { makePreferred: false, clearPreviousId: null, change: null };

/**
 * Decides how the preferred flag of a question moves after a review action.
 * Pure: the use case reads the facts, applies the status change through
 * `Claim.review`, and writes what this returns, in one transaction.
 *
 * - VERIFY: the first verified claim of a question becomes preferred.
 * - PREFER: only a verified claim; the old preferred loses the flag first.
 * - DISPUTE / REJECT of the preferred claim: the question has no published
 *   answer any more; the owner's projection decides the fallback.
 */
export function decidePreference(input: {
  action: ReviewAction;
  claimId: string;
  /** Status of the reviewed claim before the action. */
  status: ClaimStatus;
  /** Whether the reviewed claim was preferred before the action. */
  wasPreferred: boolean;
  /** The preferred claim of the question before the action, if any. */
  currentPreferredId: string | null;
}): PreferenceDecision {
  const { action, claimId, currentPreferredId } = input;

  switch (action) {
    case 'VERIFY':
      return currentPreferredId === null
        ? {
            makePreferred: true,
            clearPreviousId: null,
            change: { newPreferredClaimId: claimId, previousPreferredClaimId: null },
          }
        : UNCHANGED;

    case 'PREFER':
      if (input.status !== 'VERIFIED') {
        throw new BusinessRuleViolationError('Only a verified claim can be preferred.');
      }

      if (currentPreferredId === claimId) {
        return UNCHANGED;
      }

      return {
        makePreferred: true,
        clearPreviousId: currentPreferredId,
        change: { newPreferredClaimId: claimId, previousPreferredClaimId: currentPreferredId },
      };

    case 'DISPUTE':
    case 'REJECT':
      return input.wasPreferred
        ? {
            makePreferred: false,
            clearPreviousId: null,
            change: { newPreferredClaimId: null, previousPreferredClaimId: claimId },
          }
        : UNCHANGED;
  }
}
