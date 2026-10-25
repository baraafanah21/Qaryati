import { HttpException, HttpStatus } from '@nestjs/common';
import {
  BusinessRuleViolationError,
  ConflictError,
  DomainError,
  ErrorCode,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
  UnauthenticatedError,
  type FieldError,
} from '../../shared/kernel';
import { RequestValidationException } from './validation';

/** Media type of every error response (RFC 9457). */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Base of the `type` URI; the fragment is the code in lowercase kebab case. */
export const ERROR_DOCS_URL = 'https://github.com/baraafanah21/Qaryati/blob/main/docs/errors.md';

/**
 * Short, fixed title per code. A `Record` over every code, so adding a code to
 * the catalogue without a title is a compile error.
 */
export const ERROR_TITLES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Validation failed',
  NOT_FOUND: 'Not found',
  DUPLICATE: 'Duplicate',
  REFERENCE_CONFLICT: 'Reference conflict',
  CONSTRAINT_VIOLATION: 'Constraint violation',
  VERSION_CONFLICT: 'Version conflict',
  PRECONDITION_REQUIRED: 'Precondition required',
  UNAUTHENTICATED: 'Unauthenticated',
  INVALID_CREDENTIALS: 'Invalid credentials',
  FORBIDDEN: 'Forbidden',
  RATE_LIMITED: 'Too many requests',
  SERVICE_UNAVAILABLE: 'Service unavailable',
  INTERNAL_ERROR: 'Internal error',
};

/** Anchor of a code's section in docs/errors.md, e.g. `NOT_FOUND` → `not-found`. */
export function errorAnchor(code: ErrorCode): string {
  return code.toLowerCase().replaceAll('_', '-');
}

/** The response body of every error (RFC 9457 plus `code`, `traceId`, `timestamp`). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail: string;
  instance: string;
  traceId: string;
  timestamp: string;
  errors?: FieldError[];
}

/** How the filter should log a mapped exception. */
export type ProblemLogLevel = 'none' | 'warn' | 'error';

/** The result of mapping an exception, before request facts are added. */
export interface MappedProblem {
  status: number;
  code: ErrorCode;
  detail: string;
  errors?: FieldError[];
  log: ProblemLogLevel;
  /** Server-only facts for the log line (SQLSTATE, constraint, table). Never sent. */
  logContext?: Record<string, unknown>;
}

const GENERIC_INTERNAL_DETAIL =
  'An unexpected error occurred. Quote the traceId when reporting it.';

// Each DomainError category and its status. The domain never names a status.
const DOMAIN_STATUS: ReadonlyArray<[abstract new (...args: never[]) => DomainError, number]> = [
  [UnauthenticatedError, HttpStatus.UNAUTHORIZED],
  [NotFoundError, HttpStatus.NOT_FOUND],
  [ConflictError, HttpStatus.CONFLICT],
  [ValidationError, HttpStatus.UNPROCESSABLE_ENTITY],
  [ForbiddenError, HttpStatus.FORBIDDEN],
  [PreconditionFailedError, HttpStatus.PRECONDITION_FAILED],
  [BusinessRuleViolationError, HttpStatus.UNPROCESSABLE_ENTITY],
];

const HTTP_STATUS_CODES: Readonly<Partial<Record<number, ErrorCode>>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.DUPLICATE,
  [HttpStatus.PRECONDITION_FAILED]: ErrorCode.VERSION_CONFLICT,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.PRECONDITION_REQUIRED]: ErrorCode.PRECONDITION_REQUIRED,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

/** PostgreSQL SQLSTATEs we answer with a specific problem instead of a 500. */
const PG_ERRORS: Readonly<Record<string, { status: number; code: ErrorCode; detail: string }>> = {
  '23505': {
    status: HttpStatus.CONFLICT,
    code: ErrorCode.DUPLICATE,
    detail: 'A record with the same unique value already exists.',
  },
  '23503': {
    status: HttpStatus.CONFLICT,
    code: ErrorCode.REFERENCE_CONFLICT,
    detail: 'The record refers to, or is referred to by, another record that prevents this change.',
  },
  '23514': {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: ErrorCode.CONSTRAINT_VIOLATION,
    detail: 'The data violates a rule of the database.',
  },
  '23502': {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    code: ErrorCode.CONSTRAINT_VIOLATION,
    detail: 'A required value is missing.',
  },
  '57014': {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    code: ErrorCode.SERVICE_UNAVAILABLE,
    detail: 'The request took too long. Try again later.',
  },
};

/** The fields of a node-postgres `DatabaseError` we read. */
export interface PgErrorLike {
  code: string;
  severity?: string;
  constraint?: string;
  table?: string;
  column?: string;
  schema?: string;
  detail?: string;
}

/**
 * Walks the `cause` chain (Drizzle wraps driver errors in `DrizzleQueryError`)
 * and returns the first PostgreSQL error with a SQLSTATE, if any.
 */
export function findPgError(error: unknown): PgErrorLike | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current !== null && typeof current === 'object'; depth += 1) {
    const candidate = current as Partial<PgErrorLike> & { cause?: unknown };
    if (
      typeof candidate.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(candidate.code) &&
      typeof candidate.severity === 'string'
    ) {
      return candidate as PgErrorLike;
    }
    current = candidate.cause;
  }
  return undefined;
}

function fromHttpException(exception: HttpException): MappedProblem {
  const status = exception.getStatus();
  const response = exception.getResponse();
  const body =
    typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {};

  // An explicit catalogue code wins: new ConflictException({ code: 'VERSION_CONFLICT', message }).
  const explicit = Object.values(ErrorCode).find((code) => code === body.code);
  const isServerError = status >= 500;
  const code =
    explicit ??
    HTTP_STATUS_CODES[status] ??
    (isServerError ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_FAILED);

  const message = typeof response === 'string' ? response : body.message;
  const detail =
    isServerError && code === ErrorCode.INTERNAL_ERROR
      ? GENERIC_INTERNAL_DETAIL
      : typeof message === 'string'
        ? message
        : Array.isArray(message)
          ? message.join('; ')
          : ERROR_TITLES[code];

  return { status, code, detail, log: isServerError ? 'error' : 'none' };
}

/**
 * Maps any thrown value to a problem: the single table that decides status and
 * code for every error the API returns. See docs/errors.md.
 */
export function mapException(exception: unknown): MappedProblem {
  if (exception instanceof RequestValidationException) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: ErrorCode.VALIDATION_FAILED,
      detail: 'The request is invalid. See errors for each field.',
      errors: [...exception.errors],
      log: 'none',
    };
  }

  if (exception instanceof DomainError) {
    const status = DOMAIN_STATUS.find(([type]) => exception instanceof type)?.[1];
    if (status !== undefined) {
      const errors =
        exception instanceof ValidationError && exception.errors.length > 0
          ? [...exception.errors]
          : undefined;
      return { status, code: exception.code, detail: exception.message, errors, log: 'none' };
    }
  }

  if (exception instanceof HttpException) {
    return fromHttpException(exception);
  }

  const pgError = findPgError(exception);
  if (pgError) {
    const logContext = {
      sqlState: pgError.code,
      constraint: pgError.constraint,
      table: pgError.table,
      column: pgError.column,
    };
    const known = PG_ERRORS[pgError.code];
    if (known) {
      return { ...known, log: 'warn', logContext };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      detail: GENERIC_INTERNAL_DETAIL,
      log: 'error',
      logContext,
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ErrorCode.INTERNAL_ERROR,
    detail: GENERIC_INTERNAL_DETAIL,
    log: 'error',
  };
}

/**
 * What to log for an exception. Drizzle's `DrizzleQueryError` repeats the
 * query parameters in its message and stack, and parameters are positional,
 * so key-based redaction cannot catch an email or a password hash among them.
 * For database failures, allow-list metadata only: driver details and SQL may contain row values.
 */
export function loggableError(exception: unknown): Record<string, unknown> {
  const pgError = findPgError(exception);
  let current: unknown = exception;
  let isDrizzleError = false;
  // An outer error can repeat a wrapped Drizzle message, including its parameters.
  for (let depth = 0; depth < 10 && current !== null && typeof current === 'object'; depth += 1) {
    if ('query' in current && 'params' in current) {
      isDrizzleError = true;
      break;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  if (pgError || isDrizzleError) {
    return {
      err: 'Database operation failed',
      sqlState: pgError?.code,
      constraint: pgError?.constraint,
      table: pgError?.table,
      column: pgError?.column,
    };
  }
  return { err: exception };
}

/** Adds the request facts to a mapped problem and builds the response body. */
export function toProblemDetails(
  mapped: MappedProblem,
  request: { instance: string; traceId: string; timestamp: Date },
): ProblemDetails {
  const body: ProblemDetails = {
    type: `${ERROR_DOCS_URL}#${errorAnchor(mapped.code)}`,
    title: ERROR_TITLES[mapped.code],
    status: mapped.status,
    code: mapped.code,
    detail: mapped.detail,
    instance: request.instance,
    traceId: request.traceId,
    timestamp: request.timestamp.toISOString(),
  };
  if (mapped.errors) {
    body.errors = mapped.errors;
  }
  return body;
}
