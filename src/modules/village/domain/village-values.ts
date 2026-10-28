import { FieldErrorCode, ValidationError } from '../../../shared/kernel';

/** Settlement states supported by village identity records. */
export const SETTLEMENT_STATUSES = ['INHABITED', 'DEPOPULATED', 'MERGED'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/** Publication workflow states supported by village records. */
export const PUBLICATION_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/** Validates the stable slug format used by village identities and admin unit codes. */
export function validateSlug(slug: string): string {
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) {
    throw new ValidationError('The slug is invalid.', [
      {
        field: 'slug',
        code: FieldErrorCode.INVALID_FORMAT,
        message: 'Use 1–120 lowercase letters, digits and single hyphens.',
      },
    ]);
  }
  return slug;
}
