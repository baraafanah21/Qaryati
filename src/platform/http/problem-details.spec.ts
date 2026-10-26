import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
  PreconditionFailedException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import {
  BusinessRuleViolationError,
  ConflictError,
  ErrorCode,
  FieldErrorCode,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../shared/kernel';
import {
  ERROR_TITLES,
  errorAnchor,
  findPgError,
  loggableError,
  mapException,
  toProblemDetails,
} from './problem-details';
import { RequestValidationException } from './validation';

/** A node-postgres DatabaseError as the driver raises it. */
function pgError(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "village_slug_key"'),
    {
      code,
      severity: 'ERROR',
      constraint: 'village_slug_key',
      table: 'village',
      detail: 'Key (slug)=(beit-furik) already exists.',
      ...extra,
    },
  );
}

/** How Drizzle surfaces it: the driver error is the `cause`. */
function drizzleWrapped(error: Error) {
  return new DrizzleQueryError('insert into "village" ("slug") values ($1)', ['beit-furik'], error);
}

describe('mapException', () => {
  describe('request validation', () => {
    it('maps to 400 VALIDATION_FAILED with errors[]', () => {
      const errors = [
        {
          field: 'names[0].lang',
          code: FieldErrorCode.REQUIRED,
          message: 'This field is required.',
        },
      ];
      expect(mapException(new RequestValidationException(errors))).toMatchObject({
        status: 400,
        code: ErrorCode.VALIDATION_FAILED,
        errors,
        log: 'none',
      });
    });
  });

  describe('domain errors, by category', () => {
    it.each([
      [new NotFoundError('Village not found'), 404, ErrorCode.NOT_FOUND],
      [new ConflictError('Slug taken'), 409, ErrorCode.DUPLICATE],
      [new ValidationError('Bad slug'), 422, ErrorCode.VALIDATION_FAILED],
      [new ForbiddenError('Not your claim'), 403, ErrorCode.FORBIDDEN],
      [new PreconditionFailedError('Stale version'), 412, ErrorCode.VERSION_CONFLICT],
      [
        new BusinessRuleViolationError('Cannot verify own claim'),
        422,
        ErrorCode.CONSTRAINT_VIOLATION,
      ],
    ])('%s → %i %s', (error, status, code) => {
      expect(mapException(error)).toEqual({
        status,
        code,
        detail: error.message,
        errors: undefined,
        log: 'none',
      });
    });

    it('keeps a code chosen by the thrower', () => {
      expect(
        mapException(new ConflictError('Version changed', { code: ErrorCode.VERSION_CONFLICT })),
      ).toMatchObject({
        status: 409,
        code: ErrorCode.VERSION_CONFLICT,
      });
    });

    it('passes the field errors of a ValidationError', () => {
      const errors = [{ field: 'slug', code: FieldErrorCode.INVALID_FORMAT, message: 'Bad' }];
      expect(mapException(new ValidationError('Bad slug', errors)).errors).toEqual(errors);
    });
  });

  describe('Nest HTTP exceptions (guards, throttler, routing)', () => {
    it.each([
      [new UnauthorizedException(), 401, ErrorCode.UNAUTHENTICATED],
      [new ForbiddenException(), 403, ErrorCode.FORBIDDEN],
      [
        new HttpException('ThrottlerException: Too Many Requests', 429),
        429,
        ErrorCode.RATE_LIMITED,
      ],
      [new NotFoundException('Cannot GET /api/v1/nope'), 404, ErrorCode.NOT_FOUND],
      [new BadRequestException('Unexpected token in JSON'), 400, ErrorCode.VALIDATION_FAILED],
      [new ConflictException(), 409, ErrorCode.DUPLICATE],
      [new PreconditionFailedException(), 412, ErrorCode.VERSION_CONFLICT],
      [
        new HttpException('If-Match is required', HttpStatus.PRECONDITION_REQUIRED),
        428,
        ErrorCode.PRECONDITION_REQUIRED,
      ],
      [new PayloadTooLargeException(), 413, ErrorCode.VALIDATION_FAILED],
      [new ServiceUnavailableException(), 503, ErrorCode.SERVICE_UNAVAILABLE],
      [new InternalServerErrorException('secret internals'), 500, ErrorCode.INTERNAL_ERROR],
    ])('%s → %i %s', (exception, status, code) => {
      expect(mapException(exception)).toMatchObject({ status, code });
    });

    it('uses the exception message as detail for client errors', () => {
      expect(mapException(new UnauthorizedException('Token expired')).detail).toBe('Token expired');
    });

    it('never returns the message of an internal error', () => {
      const mapped = mapException(new InternalServerErrorException('secret internals'));
      expect(mapped.detail).not.toContain('secret');
      expect(mapped.log).toBe('error');
    });

    it('honours an explicit catalogue code in the exception body', () => {
      const exception = new ConflictException({
        code: ErrorCode.VERSION_CONFLICT,
        message: 'Changed meanwhile',
      });
      expect(mapException(exception)).toMatchObject({
        status: 409,
        code: ErrorCode.VERSION_CONFLICT,
        detail: 'Changed meanwhile',
      });
    });
  });

  describe('PostgreSQL errors', () => {
    it.each([
      ['23505', 409, ErrorCode.DUPLICATE],
      ['23503', 409, ErrorCode.REFERENCE_CONFLICT],
      ['23514', 422, ErrorCode.CONSTRAINT_VIOLATION],
      ['23502', 422, ErrorCode.CONSTRAINT_VIOLATION],
      ['57014', 503, ErrorCode.SERVICE_UNAVAILABLE],
    ])('SQLSTATE %s wrapped by Drizzle → %i %s', (sqlState, status, code) => {
      expect(mapException(drizzleWrapped(pgError(sqlState)))).toMatchObject({
        status,
        code,
        log: 'warn',
      });
    });

    it('maps the bare driver error too', () => {
      expect(mapException(pgError('23505'))).toMatchObject({
        status: 409,
        code: ErrorCode.DUPLICATE,
      });
    });

    it('keeps row details out of both the response and the log context', () => {
      const mapped = mapException(drizzleWrapped(pgError('23505')));
      expect(mapped.detail).not.toMatch(/village|slug|insert|beit-furik/);
      expect(mapped.logContext).toEqual({
        sqlState: '23505',
        constraint: 'village_slug_key',
        table: 'village',
        column: undefined,
      });
    });

    it('answers an unmapped SQLSTATE with a logged 500', () => {
      expect(mapException(drizzleWrapped(pgError('42501')))).toMatchObject({
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
        log: 'error',
        logContext: expect.objectContaining({ sqlState: '42501' }) as unknown,
      });
    });
  });

  describe('anything else', () => {
    it.each([new Error('boom'), new TypeError('x is undefined'), 'a thrown string', undefined])(
      '%p → 500 INTERNAL_ERROR with a generic detail',
      (thrown) => {
        const mapped = mapException(thrown);
        expect(mapped).toMatchObject({ status: 500, code: ErrorCode.INTERNAL_ERROR, log: 'error' });
        expect(mapped.detail).not.toMatch(/boom|undefined|thrown/);
      },
    );
  });
});

describe('findPgError', () => {
  it('walks a cause chain of any depth', () => {
    const inner = pgError('23503');
    const wrapped = new Error('outer', { cause: new Error('middle', { cause: inner }) });
    expect(findPgError(wrapped)).toBe(inner);
  });

  it('ignores errors whose code is not a SQLSTATE', () => {
    expect(findPgError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBeUndefined();
  });

  it('survives a cyclic cause chain', () => {
    const a: Error & { cause?: unknown } = new Error('a');
    a.cause = new Error('b', { cause: a });
    expect(findPgError(a)).toBeUndefined();
  });
});

describe('toProblemDetails', () => {
  it('builds the full RFC 9457 body', () => {
    const body = toProblemDetails(
      { status: 404, code: ErrorCode.NOT_FOUND, detail: 'Village not found', log: 'none' },
      {
        instance: '/api/v1/villages/x',
        traceId: 'req-12345678',
        timestamp: new Date('2026-10-15T08:00:00Z'),
      },
    );
    expect(body).toEqual({
      type: 'https://github.com/baraafanah21/Qaryati/blob/main/docs/errors.md#not-found',
      title: 'Not found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Village not found',
      instance: '/api/v1/villages/x',
      traceId: 'req-12345678',
      timestamp: '2026-10-15T08:00:00.000Z',
    });
  });

  it('adds errors only when there are some', () => {
    const errors = [{ field: 'slug', code: FieldErrorCode.REQUIRED, message: 'Required' }];
    const facts = { instance: '/', traceId: 't', timestamp: new Date(0) };
    expect(
      toProblemDetails(
        { status: 400, code: ErrorCode.VALIDATION_FAILED, detail: 'd', errors, log: 'none' },
        facts,
      ).errors,
    ).toEqual(errors);
  });
});

describe('catalogue helpers', () => {
  it('turns a code into its docs anchor', () => {
    expect(errorAnchor(ErrorCode.PRECONDITION_REQUIRED)).toBe('precondition-required');
  });

  it('has a title for every code', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_TITLES[code]).toEqual(expect.any(String));
    }
  });
});

describe('loggableError', () => {
  it('never logs driver row values, including through wrapped or non-driver Drizzle errors', () => {
    const driver = Object.assign(new Error('invalid row contains secret-hash'), {
      code: '23514',
      severity: 'ERROR',
      detail: 'Failing row contains (secret-hash, raw-token)',
      where: 'SQL with secret-hash',
      table: 'user_account',
    });
    for (const error of [
      driver,
      new Error('outer secret-hash', { cause: driver }),
      new DrizzleQueryError('SQL raw-token', ['secret-hash'], new Error('raw-token')),
      new Error('wrapped SQL raw-token', {
        cause: new DrizzleQueryError('SQL raw-token', ['secret-hash'], new Error('raw-token')),
      }),
    ]) {
      const logged = loggableError(error);
      expect(JSON.stringify({ ...logged, context: mapException(error).logContext })).not.toMatch(
        /secret-hash|raw-token|Failing row|SQL/,
      );
    }
  });
  it('never logs the parameters of a failed Drizzle query', () => {
    const cause = pgError('23505');
    const error = new DrizzleQueryError(
      'insert into "user" ("email", "password_hash") values ($1, $2)',
      ['a@example.org', '$argon2id$hash'],
      cause,
    );
    const logged = loggableError(error);
    expect(logged).toMatchObject({ err: 'Database operation failed', sqlState: '23505' });
    expect(JSON.stringify(logged)).not.toMatch(/a@example\.org|argon2|beit-furik|insert into/);
  });

  it('logs any other error as it is', () => {
    const error = new Error('boom');
    expect(loggableError(error)).toEqual({ err: error });
  });
});
