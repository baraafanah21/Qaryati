import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import type { AppEnv } from '../../config/app-env';
import { REDIS } from '../redis/redis.module';
import { rateLimitThrottlers } from './rate-limit-policy';
import { RateLimitGuard } from './rate-limit.guard';
import { RedisThrottlerStorage } from './redis-throttler-storage';

/**
 * Rate limiting for every route (#25): limits from configuration, counters in
 * Redis shared by all API instances, 429 `RATE_LIMITED` with `Retry-After`.
 *
 * AppModule must import this module **after** IamModule: global guards run in
 * registration order, and the per-user limit needs the user the JWT guard sets.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS],
      useFactory: (config: ConfigService<AppEnv, true>, redis: Redis) => ({
        storage: new RedisThrottlerStorage(redis),
        // Our guard sets Retry-After itself; the X-RateLimit-* headers would carry
        // the throttler name as a suffix and are not part of the contract.
        setHeaders: false,
        throttlers: rateLimitThrottlers({
          enabled: config.get('RATE_LIMIT_ENABLED', { infer: true }),
          anonymousPerMinute: config.get('RATE_LIMIT_ANONYMOUS_PER_MINUTE', { infer: true }),
          userPerMinute: config.get('RATE_LIMIT_USER_PER_MINUTE', { infer: true }),
          loginPerMinute: config.get('RATE_LIMIT_LOGIN_PER_MINUTE', { infer: true }),
        }),
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class RateLimitModule {}
