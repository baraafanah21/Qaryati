import { FieldErrorCode, ValidationError } from '../../../shared/kernel';

/** Bounds use JavaScript UTF-16 string length, matching the HTTP schema. */
export const PASSWORD_MIN_LENGTH = 10;
/** Allows passphrases while bounding credential input size. */
export const PASSWORD_MAX_LENGTH = 128;

/** Passwords are checked verbatim: no trimming or Unicode normalization. */
export function validatePassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new ValidationError('The password length is invalid.', [
      {
        field: 'password',
        code:
          password.length < PASSWORD_MIN_LENGTH
            ? FieldErrorCode.TOO_SHORT
            : FieldErrorCode.TOO_LONG,
        message: 'Use 10 to 128 characters.',
      },
    ]);
  }
}
