import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ProblemDetailsFilter } from './problem-details.filter';
import { RequestValidationPipe } from './validation';

/**
 * HTTP conventions every endpoint gets without asking:
 * - the global validation pipe (zod schemas, unknown properties rejected);
 * - the global problem-details exception filter.
 *
 * The request context and the `X-Request-Id` header come from
 * RequestContextModule (src/platform/context).
 */
@Module({
  providers: [
    { provide: APP_PIPE, useClass: RequestValidationPipe },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class HttpPlatformModule {}
