import { FieldErrorCode, ValidationError } from '../../../shared/kernel';
import { CLAIM_GROUP_PREFIXES, type ClaimType } from './claim-values';

/** Builds a stable grouping key for claims about the same fact. */
export function buildGroupKey(claimType: ClaimType, villageId: string, ...parts: string[]): string {
  const fail = (field: string): never => {
    throw new ValidationError('Invalid claim group key.', [
      {
        field,
        code: FieldErrorCode.INVALID_VALUE,
        message: 'Group key parts must be non-empty and cannot contain "|".',
      },
    ]);
  };

  const prefix = CLAIM_GROUP_PREFIXES[claimType];

  if (!prefix) {
    return fail('claimType');
  }

  const segments = [villageId, ...parts];

  segments.forEach((segment, index) => {
    if (typeof segment !== 'string' || !segment.trim() || segment.includes('|')) {
      fail(index === 0 ? 'villageId' : `parts.${index - 1}`);
    }
  });

  return [prefix, ...segments].join('|');
}
