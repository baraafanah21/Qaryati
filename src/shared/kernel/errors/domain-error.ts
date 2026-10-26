import { ErrorCode, type FieldError } from './error-codes';

/** Options shared by every {@link DomainError} subclass. */
export interface DomainErrorOptions {
  /** Overrides the category's default code; must come from the catalogue. */
  code?: ErrorCode;
  /** Extra, client-safe facts (ids, limits). Never secrets or SQL. */
  details?: Record<string, unknown>;
  /** The lower-level error that led to this one, kept for the logs. */
  cause?: unknown;
}

/**
 * Base class of every error the domain and application layers throw on
 * purpose. Subclasses name a category of failure, not an HTTP status, so
 * business code never mentions HTTP; the global exception filter maps each
 * category to a status (docs/kernel.md, "Throwing errors").
 */
export abstract class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  protected constructor(message: string, defaultCode: ErrorCode, options: DomainErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code ?? defaultCode;
    this.details = options.details;
  }
}

/** The addressed thing does not exist (or the caller may not know it exists). */
export class NotFoundError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super(message, ErrorCode.NOT_FOUND, options);
  }
}

/** The change clashes with existing state, e.g. a slug that is already taken. */
export class ConflictError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super(message, ErrorCode.DUPLICATE, options);
  }
}

/**
 * Input that is well-formed but invalid for the domain, e.g. a value object
 * rejecting a slug. Can carry per-field errors in the same shape as request
 * validation.
 */
export class ValidationError extends DomainError {
  readonly errors: readonly FieldError[];

  constructor(message: string, errors: readonly FieldError[] = [], options?: DomainErrorOptions) {
    super(message, ErrorCode.VALIDATION_FAILED, options);
    this.errors = errors;
  }
}

/** The caller is known but may not perform this action on this resource. */
export class ForbiddenError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super(message, ErrorCode.FORBIDDEN, options);
  }
}

/**
 * A precondition the caller sent no longer holds, typically an optimistic-lock
 * version that changed since the caller read the resource.
 */
export class PreconditionFailedError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super(message, ErrorCode.VERSION_CONFLICT, options);
  }
}

/**
 * The request is valid but a business rule forbids it, e.g. verifying one's
 * own claim. Pass a module-specific code when the client must tell rules apart.
 */
export class BusinessRuleViolationError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super(message, ErrorCode.CONSTRAINT_VIOLATION, options);
  }
}

/** Credentials failed without disclosing whether an account exists. */
export class UnauthenticatedError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super(message, ErrorCode.UNAUTHENTICATED, options);
  }
}
