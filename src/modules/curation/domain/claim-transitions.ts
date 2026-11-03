import { FieldErrorCode, ValidationError } from '../../../shared/kernel';
import type { ClaimStatus } from './claim-values';

/** Allowed review status transitions. */
export const CLAIM_TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = {
  UNVERIFIED: ['VERIFIED', 'REJECTED', 'DISPUTED', 'WITHDRAWN'],
  DISPUTED: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['DISPUTED'],
  REJECTED: [],
  WITHDRAWN: [],
};

/** Ensures a requested claim status transition is allowed. */
export function assertClaimTransition(from: ClaimStatus, to: ClaimStatus): void {
  if (CLAIM_TRANSITIONS[from]?.includes(to)) {
    return;
  }

  throw new ValidationError('Invalid claim status transition.', [
    {
      field: 'status',
      code: FieldErrorCode.INVALID_VALUE,
      message: `Cannot change claim status from ${from} to ${to}.`,
    },
  ]);
}
