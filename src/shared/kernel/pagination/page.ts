/** Largest page a list endpoint returns. Larger requests are rejected, not clamped. */
export const MAX_PAGE_SIZE = 100;

/** Page size used when the client sends none. */
export const DEFAULT_PAGE_SIZE = 20;

/** Zero-based page request, already validated by the HTTP layer. */
export interface PageRequest {
  page: number;
  size: number;
}

export type SortDirection = 'asc' | 'desc';

/** One sort key; `Field` is the endpoint's allow-list of sortable fields. */
export interface Sort<Field extends string = string> {
  field: Field;
  direction: SortDirection;
}

/** A page of results, the response shape of every offset-paginated list endpoint. */
export interface Page<T> {
  content: T[];
  page: {
    number: number;
    size: number;
    totalElements: number;
    totalPages: number;
  };
}

/** Number of rows to skip for `request`; pass it to `.offset()`, with `size` to `.limit()`. */
export function pageOffset(request: PageRequest): number {
  return request.page * request.size;
}

/**
 * Wraps the rows of one page and the total row count (from a `count(*)` with
 * the same filters) into a {@link Page}.
 */
export function toPage<T>(rows: T[], total: number, request: PageRequest): Page<T> {
  return {
    content: rows,
    page: {
      number: request.page,
      size: request.size,
      totalElements: total,
      totalPages: Math.ceil(total / request.size),
    },
  };
}

/** Applies `map` to every row of a page and keeps the page metadata. */
export function mapPage<T, U>(page: Page<T>, map: (row: T) => U): Page<U> {
  return { content: page.content.map(map), page: page.page };
}
