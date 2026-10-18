import {
  applyDecorators,
  createParamDecorator,
  HttpException,
  HttpStatus,
  Injectable,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';
import { ErrorCode, FieldErrorCode } from '../../shared/kernel';
import { RequestValidationException } from './validation';

/** The entity tag of a resource at `version`: a strong ETag, `"3"`. */
export function formatETag(version: number): string {
  return `"${version}"`;
}

const IF_MATCH = /^"(\d{1,9})"$/;

/** The result of reading an `If-Match` header. */
export type IfMatchResult =
  { kind: 'missing' } | { kind: 'malformed' } | { kind: 'version'; version: number };

/**
 * Reads the expected version from an `If-Match` header value.
 *
 * Only one strong tag in our own format (`"3"`) is accepted. A weak tag
 * (`W/"3"`), a list, `*` or anything unquoted is malformed: a write must name
 * the exact version the client read.
 */
export function parseIfMatch(header: string | string[] | undefined): IfMatchResult {
  if (header === undefined || header === '') return { kind: 'missing' };
  if (Array.isArray(header)) return { kind: 'malformed' };
  const match = IF_MATCH.exec(header.trim());
  if (!match?.[1]) return { kind: 'malformed' };
  return { kind: 'version', version: Number(match[1]) };
}

/**
 * The expected version from `If-Match`, as a number. Required on every PATCH
 * and DELETE of a versioned resource:
 *
 * ```ts
 * @Patch(':id')
 * update(@Param('id', { schema: idParam }) id: string, @IfMatch() version: number, ...) {}
 * ```
 *
 * - missing → 428 `PRECONDITION_REQUIRED`
 * - malformed → 400 `VALIDATION_FAILED` (field `If-Match`)
 *
 * It also documents the header in Swagger.
 */
export const IfMatch = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const result = parseIfMatch(request.headers['if-match']);
    switch (result.kind) {
      case 'version':
        return result.version;
      case 'missing':
        throw new HttpException(
          {
            code: ErrorCode.PRECONDITION_REQUIRED,
            message: 'Send If-Match with the ETag you last read, e.g. If-Match: "3".',
          },
          HttpStatus.PRECONDITION_REQUIRED,
        );
      default:
        throw new RequestValidationException([
          {
            field: 'If-Match',
            code: FieldErrorCode.INVALID_FORMAT,
            message: 'Must be one ETag as returned by the API, e.g. "3".',
          },
        ]);
    }
  },
  [
    (target, key) => {
      ApiHeader({
        name: 'If-Match',
        required: true,
        description: 'The ETag of the version you read, e.g. "3". Missing → 428.',
        schema: { type: 'string', example: '"3"' },
      })(
        target,
        key as string,
        Object.getOwnPropertyDescriptor(target, key as string) as PropertyDescriptor,
      );
    },
  ],
);

/** Sets `ETag` from the `version` of the returned body. */
@Injectable()
export class ETagInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = ctx.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((body: unknown) => {
        const version = (body as { version?: unknown } | null)?.version;
        if (typeof version !== 'number') {
          throw new Error('@ETag() needs a response body with a numeric version.');
        }
        response.setHeader('ETag', formatETag(version));
        return body;
      }),
    );
  }
}

/**
 * Sends `ETag: "<version>"` with a single-resource response, taken from the
 * body's `version`. Put it on GET, POST (create) and PATCH of a versioned
 * resource; the client sends the value back in `If-Match`.
 */
export function ETag(): MethodDecorator & ClassDecorator {
  return applyDecorators(UseInterceptors(ETagInterceptor));
}
