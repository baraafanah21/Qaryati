import type { ArgumentMetadata } from '@nestjs/common';
import { z } from 'zod';
import { FieldErrorCode } from '../../shared/kernel';
import {
  findNonStrictObject,
  formatFieldPath,
  RequestValidationException,
  RequestValidationPipe,
} from './validation';

const body = (schema: z.ZodType): ArgumentMetadata => ({ type: 'body', schema });

async function errorsOf(schema: z.ZodType, value: unknown) {
  try {
    await new RequestValidationPipe().transform(value, body(schema));
  } catch (error) {
    if (error instanceof RequestValidationException) return error.errors;
    throw error;
  }
  throw new Error('expected validation to fail');
}

const villageBody = z.strictObject({
  slug: z.string().min(3).max(10),
  population: z.number().int().min(0).max(1_000_000).optional(),
  names: z
    .array(z.strictObject({ lang: z.enum(['ar', 'en']), value: z.string() }))
    .min(1)
    .max(2),
  foundedOn: z.iso
    .date()
    .refine((value) => value <= '2026-10-15', {
      params: { code: FieldErrorCode.MUST_NOT_BE_FUTURE },
      message: 'Must not be in the future.',
    })
    .optional(),
  website: z.url().optional(),
});

const valid = { slug: 'beit-furik', names: [{ lang: 'ar', value: 'بيت فوريك' }] };

describe('RequestValidationPipe', () => {
  it('returns the parsed value when the input is valid', async () => {
    await expect(new RequestValidationPipe().transform(valid, body(villageBody))).resolves.toEqual(
      valid,
    );
  });

  it('leaves parameters without a schema untouched', async () => {
    await expect(new RequestValidationPipe().transform('raw', { type: 'param' })).resolves.toBe(
      'raw',
    );
  });

  it('coerces query values to their types', async () => {
    const query = z.strictObject({ page: z.coerce.number().int() });
    await expect(
      new RequestValidationPipe().transform({ page: '3' }, { type: 'query', schema: query }),
    ).resolves.toEqual({ page: 3 });
  });

  it.each([
    ['a missing field', { names: valid.names }, 'slug', FieldErrorCode.REQUIRED],
    [
      'a missing enum value',
      { ...valid, names: [{ value: 'x' }] },
      'names[0].lang',
      FieldErrorCode.REQUIRED,
    ],
    [
      'a wrong enum value',
      { ...valid, names: [{ lang: 'fr', value: 'x' }] },
      'names[0].lang',
      FieldErrorCode.INVALID_VALUE,
    ],
    ['a wrong type', { ...valid, slug: 42 }, 'slug', FieldErrorCode.INVALID_TYPE],
    ['a fraction', { ...valid, population: 1.5 }, 'population', FieldErrorCode.NOT_INTEGER],
    ['a short string', { ...valid, slug: 'ab' }, 'slug', FieldErrorCode.TOO_SHORT],
    ['a long string', { ...valid, slug: 'x'.repeat(11) }, 'slug', FieldErrorCode.TOO_LONG],
    ['a small number', { ...valid, population: -1 }, 'population', FieldErrorCode.TOO_SMALL],
    ['a large number', { ...valid, population: 2_000_000 }, 'population', FieldErrorCode.TOO_LARGE],
    ['an empty list', { ...valid, names: [] }, 'names', FieldErrorCode.TOO_FEW],
    [
      'a long list',
      { ...valid, names: [...valid.names, ...valid.names, ...valid.names] },
      'names',
      FieldErrorCode.TOO_MANY,
    ],
    ['a bad format', { ...valid, website: 'not a url' }, 'website', FieldErrorCode.INVALID_FORMAT],
    [
      'a rule-specific check',
      { ...valid, foundedOn: '2030-01-01' },
      'foundedOn',
      FieldErrorCode.MUST_NOT_BE_FUTURE,
    ],
    [
      'an unknown top-level field',
      { ...valid, admin: true },
      'admin',
      FieldErrorCode.UNKNOWN_FIELD,
    ],
    [
      'an unknown nested field',
      { ...valid, names: [{ lang: 'ar', value: 'x', x: 1 }] },
      'names[0].x',
      FieldErrorCode.UNKNOWN_FIELD,
    ],
  ])('reports %s with a stable code', async (_label, input, field, code) => {
    const errors = await errorsOf(villageBody, input);
    expect(errors).toEqual([{ field, code, message: expect.any(String) as string }]);
  });

  it('keeps the message of a rule-specific check', async () => {
    const [error] = await errorsOf(villageBody, { ...valid, foundedOn: '2030-01-01' });
    expect(error?.message).toBe('Must not be in the future.');
  });

  it('falls back to INVALID_VALUE for an unknown custom code', async () => {
    const schema = z.strictObject({
      a: z.string().refine(() => false, { params: { code: 'NOT_IN_CATALOGUE' } }),
    });
    expect(await errorsOf(schema, { a: 'x' })).toEqual([
      expect.objectContaining({ field: 'a', code: FieldErrorCode.INVALID_VALUE }),
    ]);
  });

  it('reports every problem at once', async () => {
    const errors = await errorsOf(villageBody, { slug: 'ab', names: [], extra: 1 });
    expect(errors.map((e) => e.field).sort()).toEqual(['extra', 'names', 'slug']);
  });

  it('refuses a schema that would silently strip unknown properties', async () => {
    const loose = z.object({ a: z.string() });
    await expect(new RequestValidationPipe().transform({ a: 'x' }, body(loose))).rejects.toThrow(
      'Use z.strictObject(...)',
    );
  });
});

describe('findNonStrictObject', () => {
  it('accepts strict objects at every depth', () => {
    expect(findNonStrictObject(villageBody)).toBeUndefined();
  });

  it.each([
    ['the root', z.object({}), '(root)'],
    ['a nested object', z.strictObject({ a: z.object({}) }), 'a'],
    [
      'an object in an optional array',
      z.strictObject({ list: z.array(z.object({})).optional() }),
      'list',
    ],
  ])('finds a loose object at %s', (_label, schema, path) => {
    expect(findNonStrictObject(schema)).toBe(path);
  });
});

describe('formatFieldPath', () => {
  it.each([
    [['names', 0, 'lang'], 'names[0].lang'],
    [['a', { key: 'b' }], 'a.b'],
    [[], ''],
  ])('renders %j as %j', (path, expected) => {
    expect(formatFieldPath(path)).toBe(expected);
  });
});
