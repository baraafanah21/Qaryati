import { Global, Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { REQUEST_ID_HEADER, resolveRequestId } from '../http/request-id';
import { RequestContext } from './request-context';

/**
 * The per-request context (nestjs-cls) and its typed accessor
 * {@link RequestContext}, available to every module.
 *
 * The CLS middleware opens one context per HTTP request whose id is the
 * request ID, echoed in `X-Request-Id`. The same context later holds the
 * actor ID (#10), the active database transaction and the domain events
 * waiting for its commit.
 */
@Global()
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
  providers: [RequestContext],
  exports: [RequestContext],
})
export class RequestContextModule {}
