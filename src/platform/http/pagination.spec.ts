import { z } from 'zod';
import { FieldErrorCode, toPage } from '../../shared/kernel';
import { idParam, pageResponse, paginationQuery, sortQuery } from './pagination';
import { RequestValidationException, RequestValidationPipe } from './validation';

const listQuery = paginationQuery.extend({ sort: sortQuery(['name', 'createdAt']) });

async function parse(query: Record<string, unknown>) {
  return new RequestValidationPipe().transform(query, { type: 'query', schema: listQuery });
}

async function errorsOf(query: Record<string, unknown>) {
  try {
    await parse(query);
  } catch (error) {
    if (error instanceof RequestValidationException) return error.errors;
    throw error;
  }
  throw new Error('expected validation to fail');
}

describe('paginationQuery', () => {
  it('defaults to page 0, size 20, no sort', async () => {
    await expect(parse({})).resolves.toEqual({ page: 0, size: 20, sort: [] });
  });

  it('turns query strings into numbers', async () => {
    await expect(parse({ page: '3', size: '100' })).resolves.toMatchObject({ page: 3, size: 100 });
  });

  it.each([
    ['size=0', { size: '0' }, 'size', FieldErrorCode.TOO_SMALL],
    ['size=101', { size: '101' }, 'size', FieldErrorCode.TOO_LARGE],
    ['size=500 (rejected, not clamped)', { size: '500' }, 'size', FieldErrorCode.TOO_LARGE],
    ['page=-1', { page: '-1' }, 'page', FieldErrorCode.TOO_SMALL],
    ['page=abc', { page: 'abc' }, 'page', FieldErrorCode.INVALID_TYPE],
    ['size=2.5', { size: '2.5' }, 'size', FieldErrorCode.NOT_INTEGER],
    ['an unknown parameter', { pgae: '1' }, 'pgae', FieldErrorCode.UNKNOWN_FIELD],
  ])('rejects %s', async (_label, query, field, code) => {
    expect(await errorsOf(query)).toEqual([{ field, code, message: expect.any(String) as string }]);
  });
});

describe('sortQuery', () => {
  it('parses one sort with a direction', async () => {
    await expect(parse({ sort: 'name,desc' })).resolves.toMatchObject({
      sort: [{ field: 'name', direction: 'desc' }],
    });
  });

  it('defaults the direction to asc and accepts repeated sort parameters', async () => {
    await expect(parse({ sort: ['createdAt', 'name,desc'] })).resolves.toMatchObject({
      sort: [
        { field: 'createdAt', direction: 'asc' },
        { field: 'name', direction: 'desc' },
      ],
    });
  });

  it('returns the default sort when none is sent', async () => {
    const schema = paginationQuery.extend({
      sort: sortQuery(['name'], [{ field: 'name', direction: 'asc' }]),
    });
    await expect(
      new RequestValidationPipe().transform({}, { type: 'query', schema }),
    ).resolves.toMatchObject({
      sort: [{ field: 'name', direction: 'asc' }],
    });
  });

  it.each([
    [
      'a field outside the allow-list',
      { sort: 'password,asc' },
      'sort',
      FieldErrorCode.NOT_ALLOWED,
    ],
    ['an unknown direction', { sort: 'name,up' }, 'sort', FieldErrorCode.INVALID_VALUE],
    ['extra parts', { sort: 'name,asc,x' }, 'sort', FieldErrorCode.INVALID_VALUE],
    [
      'the second of two sorts',
      { sort: ['name', 'secret'] },
      'sort[1]',
      FieldErrorCode.NOT_ALLOWED,
    ],
    ['a repeated field', { sort: ['name', 'name,desc'] }, 'sort[1]', FieldErrorCode.INVALID_VALUE],
  ])('rejects %s', async (_label, query, field, code) => {
    expect(await errorsOf(query)).toEqual([{ field, code, message: expect.any(String) as string }]);
  });
});

describe('idParam', () => {
  it('accepts a UUID and rejects anything else', () => {
    expect(idParam.safeParse('0192f0c4-8e1a-7c3b-9d2e-5f6a7b8c9d0e').success).toBe(true);
    expect(idParam.safeParse('42').success).toBe(false);
  });
});

describe('pageResponse', () => {
  it('describes the Page<T> that toPage returns', () => {
    const schema = pageResponse(z.strictObject({ name: z.string() }));
    expect(
      schema.safeParse(toPage([{ name: 'Beit Furik' }], 1, { page: 0, size: 20 })).success,
    ).toBe(true);
    expect(schema.safeParse({ content: [{ name: 1 }], page: {} }).success).toBe(false);
  });
});
