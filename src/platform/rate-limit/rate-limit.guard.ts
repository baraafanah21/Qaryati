import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Response } from 'express';
import { SKIP_RATE_LIMIT } from '../http/rate-limit.decorators';

/**
 * The global rate-limit guard: `@nestjs/throttler` with three named limits
 * (rate-limit.module.ts), plus what the library does not do for us:
 *
 * - `Retry-After` is always the plain header name. The library would suffix it
 *   with the throttler name (`Retry-After-login`), which no client understands.
 * - `@SkipRateLimit()` exempts health probes from every limit at once.
 *
 * It must run **after** the JWT guard, so per-user limits see `req.user`: AppModule
 * imports RateLimitModule after IamModule, and global guards run in that order.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override shouldSkip(context: ExecutionContext): Promise<boolean> {
    const skipped = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    return Promise.resolve(skipped === true);
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', String(Math.max(1, detail.timeToBlockExpire)));
    await super.throwThrottlingException(context, detail);
  }
}
