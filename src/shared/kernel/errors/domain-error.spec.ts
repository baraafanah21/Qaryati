import {
  BusinessRuleViolationError,
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from './domain-error';
import { ErrorCode, FieldErrorCode } from './error-codes';

describe('DomainError subclasses', () => {
  it.each([
    [new NotFoundError('m'), ErrorCode.NOT_FOUND],
    [new ConflictError('m'), ErrorCode.DUPLICATE],
    [new ValidationError('m'), ErrorCode.VALIDATION_FAILED],
    [new ForbiddenError('m'), ErrorCode.FORBIDDEN],
    [new PreconditionFailedError('m'), ErrorCode.VERSION_CONFLICT],
    [new BusinessRuleViolationError('m'), ErrorCode.CONSTRAINT_VIOLATION],
  ])('%s defaults to code %s', (error, code) => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    expect(error.message).toBe('m');
  });

  it('takes a code, details and cause from options', () => {
    const cause = new Error('low level');
    const error = new ConflictError('Slug taken', {
      code: ErrorCode.REFERENCE_CONFLICT,
      details: { slug: 'beit-furik' },
      cause,
    });
    expect(error.code).toBe(ErrorCode.REFERENCE_CONFLICT);
    expect(error.details).toEqual({ slug: 'beit-furik' });
    expect(error.cause).toBe(cause);
  });

  it('names the error after its class, for logs and stack traces', () => {
    expect(new NotFoundError('m').name).toBe('NotFoundError');
  });

  it('carries field errors on ValidationError', () => {
    const errors = [{ field: 'slug', code: FieldErrorCode.INVALID_FORMAT, message: 'bad' }];
    expect(new ValidationError('Invalid slug', errors).errors).toEqual(errors);
  });
});
