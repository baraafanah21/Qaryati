import { FieldErrorCode, ValidationError } from '../../../shared/kernel';

/** Shared syntax for the domain and HTTP boundary; provider-specific rewriting is forbidden. */
export const EMAIL_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9_+.-]*[A-Za-z0-9_+-])?@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** Canonical account identifier; citext remains the database uniqueness guarantee. */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email) || email.includes('..')) {
    throw new ValidationError('The email is invalid.', [
      {
        field: 'email',
        code: FieldErrorCode.INVALID_FORMAT,
        message: 'Use a valid email address.',
      },
    ]);
  }
  return email;
}
