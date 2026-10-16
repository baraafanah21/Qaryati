import {
  BadRequestException,
  Injectable,
  StandardSchemaValidationPipe,
  type ArgumentMetadata,
} from '@nestjs/common';
import { FieldErrorCode, type FieldError } from '../../shared/kernel';

/**
 * Thrown by {@link RequestValidationPipe} when a body, query or path parameter
 * fails its schema. The exception filter turns it into a 400
 * `VALIDATION_FAILED` problem with `errors[]`.
 */
export class RequestValidationException extends BadRequestException {
  constructor(readonly errors: readonly FieldError[]) {
    super('The request is invalid.');
  }
}

type PathSegment = PropertyKey | { readonly key: PropertyKey };

/** A Standard Schema issue: the spec guarantees only `message` and `path`. */
export interface SchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PathSegment> | undefined;
}

/** The extra fields zod adds to an issue; all optional, as other validators lack them. */
interface ZodLikeIssue extends SchemaIssue {
  code?: string;
  origin?: string;
  expected?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  keys?: string[];
  params?: { code?: unknown };
}

const KNOWN_FIELD_CODES = new Set<string>(Object.values(FieldErrorCode));

/** Renders a path as `names[0].lang`. An empty path (the whole value) renders as `''`. */
export function formatFieldPath(path: ReadonlyArray<PathSegment>): string {
  return path
    .map((segment) => (typeof segment === 'object' ? segment.key : segment))
    .reduce<string>((acc, key) => {
      if (typeof key === 'number') return `${acc}[${key}]`;
      return acc === '' ? String(key) : `${acc}.${String(key)}`;
    }, '');
}

function valueAt(input: unknown, path: ReadonlyArray<PathSegment>): unknown {
  let current = input;
  for (const segment of path) {
    const key = typeof segment === 'object' ? segment.key : segment;
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function toFieldError(issue: ZodLikeIssue, input: unknown): FieldError[] {
  const path = issue.path ?? [];
  const field = formatFieldPath(path);

  if (issue.code === 'unrecognized_keys') {
    return (issue.keys ?? []).map((key) => ({
      field: formatFieldPath([...path, key]),
      code: FieldErrorCode.UNKNOWN_FIELD,
      message: 'This field is not allowed.',
    }));
  }

  // zod reports a missing enum or union value like a wrong one; the input
  // tells the two apart.
  if (
    path.length > 0 &&
    valueAt(input, path) === undefined &&
    ['invalid_type', 'invalid_value', 'invalid_union'].includes(issue.code ?? '')
  ) {
    return [{ field, code: FieldErrorCode.REQUIRED, message: 'This field is required.' }];
  }

  const isText = issue.origin === 'string';
  const isList = issue.origin === 'array' || issue.origin === 'set';
  switch (issue.code) {
    case 'invalid_type':
      return issue.expected === 'int'
        ? [{ field, code: FieldErrorCode.NOT_INTEGER, message: 'Must be an integer.' }]
        : [
            {
              field,
              code: FieldErrorCode.INVALID_TYPE,
              message: `Must be of type ${issue.expected ?? 'unknown'}.`,
            },
          ];
    case 'too_big': {
      const max = String(issue.maximum);
      if (isText)
        return [
          { field, code: FieldErrorCode.TOO_LONG, message: `Must be at most ${max} characters.` },
        ];
      if (isList)
        return [
          { field, code: FieldErrorCode.TOO_MANY, message: `Must contain at most ${max} items.` },
        ];
      return [{ field, code: FieldErrorCode.TOO_LARGE, message: `Must be at most ${max}.` }];
    }
    case 'too_small': {
      const min = String(issue.minimum);
      if (isText)
        return [
          { field, code: FieldErrorCode.TOO_SHORT, message: `Must be at least ${min} characters.` },
        ];
      if (isList)
        return [
          { field, code: FieldErrorCode.TOO_FEW, message: `Must contain at least ${min} items.` },
        ];
      return [{ field, code: FieldErrorCode.TOO_SMALL, message: `Must be at least ${min}.` }];
    }
    case 'invalid_format':
      return [{ field, code: FieldErrorCode.INVALID_FORMAT, message: 'Has an invalid format.' }];
    case 'custom': {
      // Rule-specific checks pass their code through `params.code`
      // (docs/kernel.md, "Validating a request").
      const code = issue.params?.code;
      return [
        {
          field,
          code:
            typeof code === 'string' && KNOWN_FIELD_CODES.has(code)
              ? (code as FieldErrorCode)
              : FieldErrorCode.INVALID_VALUE,
          message: issue.message,
        },
      ];
    }
    default:
      return [{ field, code: FieldErrorCode.INVALID_VALUE, message: 'Has an invalid value.' }];
  }
}

/**
 * Translates validator issues into the stable `errors[]` of a problem
 * response. `input` is the value that was validated; it is used only to tell
 * a missing field from a wrong one.
 */
export function toFieldErrors(issues: readonly SchemaIssue[], input: unknown): FieldError[] {
  return issues.flatMap((issue) => toFieldError(issue as ZodLikeIssue, input));
}

interface ZodDefLike {
  type?: string;
  shape?: Record<string, { _zod?: { def?: ZodDefLike } }>;
  catchall?: { _zod?: { def?: ZodDefLike } };
  element?: { _zod?: { def?: ZodDefLike } };
  innerType?: { _zod?: { def?: ZodDefLike } };
  in?: { _zod?: { def?: ZodDefLike } };
  out?: { _zod?: { def?: ZodDefLike } };
  options?: Array<{ _zod?: { def?: ZodDefLike } }>;
}

/**
 * Finds the first object schema that silently strips unknown keys (`z.object`
 * instead of `z.strictObject`), returning its path, or `undefined` if every
 * object in the schema is strict. Non-zod schemas are not inspected.
 */
export function findNonStrictObject(
  schema: unknown,
  path = '',
  seen = new Set<unknown>(),
): string | undefined {
  const def = (schema as { _zod?: { def?: ZodDefLike } } | undefined)?._zod?.def;
  if (!def || seen.has(def)) return undefined;
  seen.add(def);
  if (def.type === 'object') {
    if (def.catchall?._zod?.def?.type !== 'never') return path || '(root)';
    for (const [key, child] of Object.entries(def.shape ?? {})) {
      const found = findNonStrictObject(child, path ? `${path}.${key}` : key, seen);
      if (found) return found;
    }
    return undefined;
  }
  const children = [def.element, def.innerType, def.in, def.out, ...(def.options ?? [])];
  for (const child of children) {
    const found = child && findNonStrictObject(child, path, seen);
    if (found) return found;
  }
  return undefined;
}

/**
 * The global validation pipe. It validates every `@Body`, `@Query` and
 * `@Param` that declares a `schema` (a zod schema, through Nest's Standard
 * Schema support) and returns the parsed value, so `z.coerce.number()` turns
 * `?page=2` into the number 2.
 *
 * Request schemas must reject unknown properties. An object schema that would
 * strip them instead is a programming error: the pipe throws a plain `Error`
 * (a 500, logged with the schema path) the first time the route is called, so
 * the mistake shows up in the route's first test.
 */
@Injectable()
export class RequestValidationPipe extends StandardSchemaValidationPipe {
  private readonly checkedSchemas = new WeakSet<object>();

  constructor() {
    super({ transform: true });
  }

  override async transform<T = unknown>(value: T, metadata: ArgumentMetadata): Promise<T> {
    const schema = metadata.schema;
    if (!schema || !this.toValidate(metadata)) {
      return value;
    }
    this.assertStrict(schema, metadata);
    this.stripProtoKeys(value);
    const result = await this.validate<T>(value, schema, this.validateOptions);
    if (result.issues) {
      throw new RequestValidationException(toFieldErrors(result.issues, value));
    }
    return result.value;
  }

  private assertStrict(schema: object, metadata: ArgumentMetadata): void {
    if (this.checkedSchemas.has(schema)) return;
    const loose = findNonStrictObject(schema);
    if (loose) {
      throw new Error(
        `The ${metadata.type} schema has a non-strict object at "${loose}". ` +
          'Use z.strictObject(...) so unknown properties are rejected (docs/kernel.md).',
      );
    }
    this.checkedSchemas.add(schema);
  }
}
