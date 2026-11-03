import { ValidationError } from '../../../shared/kernel';
import { assertClaimTransition, CLAIM_TRANSITIONS } from './claim-transitions';
import { CLAIM_STATUSES } from './claim-values';

describe('Claim status transitions', () => {
  const allPairs = CLAIM_STATUSES.flatMap((from) => CLAIM_STATUSES.map((to) => ({ from, to })));

  it.each(allPairs)('checks transition from $from to $to', ({ from, to }) => {
    const allowed = CLAIM_TRANSITIONS[from].includes(to);

    if (allowed) {
      expect(() => assertClaimTransition(from, to)).not.toThrow();
    } else {
      expect(() => assertClaimTransition(from, to)).toThrow(ValidationError);
    }
  });
});
