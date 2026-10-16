import { Catch, Inject, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CLOCK, type Clock } from '../../shared/kernel';
import {
  loggableError,
  mapException,
  PROBLEM_CONTENT_TYPE,
  toProblemDetails,
} from './problem-details';
import { resolveRequestId } from './request-id';

/**
 * The global exception filter: every error leaves the API as
 * `application/problem+json` with the same shape (docs/errors.md). Registered
 * once, as `APP_FILTER` in HttpPlatformModule.
 *
 * Expected failures (4xx) are not logged here; the access log line already
 * shows the status. Database errors mapped to 4xx/503 are logged at `warn`
 * with the SQLSTATE and constraint, which never reach the client. Anything
 * unexpected is logged at `error` with the full error and stack.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(ProblemDetailsFilter.name) private readonly logger: PinoLogger,
    private readonly cls: ClsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const mapped = mapException(exception);
    // The CLS context exists for every routed request; the fallback covers
    // errors raised before it was entered.
    const traceId =
      this.cls.isActive() && this.cls.getId()
        ? this.cls.getId()
        : resolveRequestId(request, response);
    const instance = (request.originalUrl ?? request.url).split('?')[0] ?? '/';

    if (mapped.log !== 'none') {
      // requestId is already bound to every line of this request by pino-http.
      const fields = {
        ...loggableError(exception),
        code: mapped.code,
        status: mapped.status,
        ...mapped.logContext,
      };
      if (mapped.log === 'error') {
        this.logger.error(fields, 'Request failed with an unexpected error');
      } else {
        this.logger.warn(fields, 'Request rejected by the database');
      }
    }

    if (response.headersSent) {
      return;
    }
    const body = toProblemDetails(mapped, { instance, traceId, timestamp: this.clock.now() });
    response.status(mapped.status).type(PROBLEM_CONTENT_TYPE).json(body);
  }
}
