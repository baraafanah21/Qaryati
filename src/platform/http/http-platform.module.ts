import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { ProblemDetailsFilter } from './problem-details.filter';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id';
import { RequestValidationPipe } from './validation';

/**
 * HTTP conventions every endpoint gets without asking:
 * - a request context (nestjs-cls) whose id is the request ID, echoed in
 *   `X-Request-Id` (part 2 of #9 keeps the transaction in the same context);
 * - the global validation pipe (zod schemas, unknown properties rejected);
 * - the global problem-details exception filter.
 */
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Parameters<typeof resolveRequestId>[0]) => resolveRequestId(req),
        setup: (cls, _req, res: { setHeader(name: string, value: string): void }) => {
          res.setHeader(REQUEST_ID_HEADER, cls.getId());
        },
      },
    }),
  ],
  providers: [
    { provide: APP_PIPE, useClass: RequestValidationPipe },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class HttpPlatformModule {}
