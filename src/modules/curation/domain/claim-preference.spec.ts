import { BusinessRuleViolationError } from '../../../shared/kernel';
import { decidePreference, isReviewAction, REVIEW_ACTIONS } from './claim-preference';

const CLAIM = 'claim-a';
const OTHER = 'claim-b';

describe('decidePreference', () => {
  describe('VERIFY', () => {
    it('makes the first verified claim of a question preferred', () => {
      expect(
        decidePreference({
          action: 'VERIFY',
          claimId: CLAIM,
          status: 'UNVERIFIED',
          wasPreferred: false,
          currentPreferredId: null,
        }),
      ).toEqual({
        makePreferred: true,
        clearPreviousId: null,
        change: { newPreferredClaimId: CLAIM, previousPreferredClaimId: null },
      });
    });

    it('leaves an existing preferred claim in place', () => {
      expect(
        decidePreference({
          action: 'VERIFY',
          claimId: CLAIM,
          status: 'DISPUTED',
          wasPreferred: false,
          currentPreferredId: OTHER,
        }),
      ).toEqual({ makePreferred: false, clearPreviousId: null, change: null });
    });
  });

  describe('PREFER', () => {
    it('moves the flag from the old preferred claim', () => {
      expect(
        decidePreference({
          action: 'PREFER',
          claimId: CLAIM,
          status: 'VERIFIED',
          wasPreferred: false,
          currentPreferredId: OTHER,
        }),
      ).toEqual({
        makePreferred: true,
        clearPreviousId: OTHER,
        change: { newPreferredClaimId: CLAIM, previousPreferredClaimId: OTHER },
      });
    });

    it('sets the flag when the question has no preferred claim', () => {
      expect(
        decidePreference({
          action: 'PREFER',
          claimId: CLAIM,
          status: 'VERIFIED',
          wasPreferred: false,
          currentPreferredId: null,
        }),
      ).toMatchObject({ makePreferred: true, clearPreviousId: null });
    });

    it('changes nothing when the claim is already preferred', () => {
      expect(
        decidePreference({
          action: 'PREFER',
          claimId: CLAIM,
          status: 'VERIFIED',
          wasPreferred: true,
          currentPreferredId: CLAIM,
        }),
      ).toEqual({ makePreferred: false, clearPreviousId: null, change: null });
    });

    it.each(['UNVERIFIED', 'DISPUTED', 'REJECTED', 'WITHDRAWN'] as const)(
      'refuses a %s claim',
      (status) => {
        expect(() =>
          decidePreference({
            action: 'PREFER',
            claimId: CLAIM,
            status,
            wasPreferred: false,
            currentPreferredId: null,
          }),
        ).toThrow(BusinessRuleViolationError);
      },
    );
  });

  describe.each(['DISPUTE', 'REJECT'] as const)('%s', (action) => {
    it('unpublishes the preferred claim and reports no new preferred claim', () => {
      expect(
        decidePreference({
          action,
          claimId: CLAIM,
          status: 'VERIFIED',
          wasPreferred: true,
          currentPreferredId: CLAIM,
        }),
      ).toEqual({
        makePreferred: false,
        clearPreviousId: null,
        change: { newPreferredClaimId: null, previousPreferredClaimId: CLAIM },
      });
    });

    it('changes nothing for a claim that was not preferred', () => {
      expect(
        decidePreference({
          action,
          claimId: CLAIM,
          status: 'UNVERIFIED',
          wasPreferred: false,
          currentPreferredId: OTHER,
        }),
      ).toEqual({ makePreferred: false, clearPreviousId: null, change: null });
    });
  });
});

describe('isReviewAction', () => {
  it.each(REVIEW_ACTIONS)('accepts %s', (action) => {
    expect(isReviewAction(action)).toBe(true);
  });

  it.each(['verify', 'WITHDRAW', '', 1, null])('rejects %p', (value) => {
    expect(isReviewAction(value)).toBe(false);
  });
});
