import { z } from 'zod';
import {
  DEFAULT_PAGE_SIZE,
  FieldErrorCode,
  MAX_PAGE_SIZE,
  type Sort,
  type SortDirection,
} from '../../shared/kernel';

/**
 * Query schema of `?page=&size=` for offset pagination. `page` is zero-based.
 * Out-of-range values are rejected with 400, never clamped, so a client
 * asking for `size=500` learns the limit instead of silently getting 100.
 *
 * Extend it per endpoint: `paginationQuery.extend({ sort: sortQuery([...]) })`.
 */
export const paginationQuery = z.strictObject({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/** Parsed `?page=&size=`. */
export type PaginationQuery = z.infer<typeof paginationQuery>;

const DIRECTIONS: readonly SortDirection[] = ['asc', 'desc'];

/**
 * Query schema of a repeatable `sort=field[,asc|desc]` parameter, limited to
 * the fields in `allowed`. Each endpoint lists the fields it can sort by (and
 * has an index for); anything else is a 400 `VALIDATION_FAILED` with field
 * code `NOT_ALLOWED`. The direction defaults to `asc`; a field may appear once.
 *
 * Returns `defaultSort` when the parameter is absent.
 */
export function sortQuery<const Field extends string>(
  allowed: readonly [Field, ...Field[]],
  defaultSort: Sort<Field>[] = [],
) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((raw, ctx): Sort<Field>[] => {
      if (raw === undefined) return defaultSort;
      const entries = Array.isArray(raw) ? raw : [raw];
      const sorts: Sort<Field>[] = [];
      entries.forEach((entry, index) => {
        const path = Array.isArray(raw) ? [index] : [];
        const [field = '', direction = 'asc', ...rest] = entry
          .split(',')
          .map((part) => part.trim());
        if (!(allowed as readonly string[]).includes(field)) {
          ctx.addIssue({
            code: 'custom',
            path,
            params: { code: FieldErrorCode.NOT_ALLOWED },
            message: `Cannot sort by "${field}". Allowed: ${allowed.join(', ')}.`,
          });
          return;
        }
        if (rest.length > 0 || !(DIRECTIONS as readonly string[]).includes(direction)) {
          ctx.addIssue({
            code: 'custom',
            path,
            params: { code: FieldErrorCode.INVALID_VALUE },
            message: 'Use sort=field,asc or sort=field,desc.',
          });
          return;
        }
        if (sorts.some((sort) => sort.field === field)) {
          ctx.addIssue({
            code: 'custom',
            path,
            params: { code: FieldErrorCode.INVALID_VALUE },
            message: `"${field}" appears more than once in sort.`,
          });
          return;
        }
        sorts.push({ field: field as Field, direction: direction as SortDirection });
      });
      return sorts;
    });
}

/** Path parameter schema for an entity id: `@Param('id', { schema: idParam }) id: string`. */
export const idParam = z.uuid();
