/**
 * Catalogue of the stable error codes the API returns in the `code` field of a
 * problem response. Clients branch on these, never on `title` or `detail`.
 *
 * Every code has a section in docs/errors.md (a unit test checks it). A module
 * that needs a new code adds it here, with its section, in the same PR.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE: 'DUPLICATE',
  REFERENCE_CONFLICT: 'REFERENCE_CONFLICT',
  CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  PRECONDITION_REQUIRED: 'PRECONDITION_REQUIRED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/** One of the codes in {@link ErrorCode}. */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Stable codes for a single invalid field, returned in `errors[].code` of a
 * `VALIDATION_FAILED` response. Library wording never reaches the client; the
 * HTTP layer translates validator output into these. A module that needs a
 * rule-specific code (like `MUST_NOT_BE_FUTURE`) adds it here.
 */
export const FieldErrorCode = {
  REQUIRED: 'REQUIRED',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  INVALID_TYPE: 'INVALID_TYPE',
  NOT_INTEGER: 'NOT_INTEGER',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_VALUE: 'INVALID_VALUE',
  NOT_ALLOWED: 'NOT_ALLOWED',
  TOO_SHORT: 'TOO_SHORT',
  TOO_LONG: 'TOO_LONG',
  TOO_SMALL: 'TOO_SMALL',
  TOO_LARGE: 'TOO_LARGE',
  TOO_FEW: 'TOO_FEW',
  TOO_MANY: 'TOO_MANY',
  MUST_NOT_BE_FUTURE: 'MUST_NOT_BE_FUTURE',
} as const;

/** One of the codes in {@link FieldErrorCode}. */
export type FieldErrorCode = (typeof FieldErrorCode)[keyof typeof FieldErrorCode];

/** One invalid field: `field` is the full path, e.g. `names[0].lang`. */
export interface FieldError {
  field: string;
  code: FieldErrorCode;
  message: string;
}
