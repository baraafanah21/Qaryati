import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AppEnv } from '../../config/app-env';

/** Injection token of the shared ioredis client: `@Inject(REDIS) redis: Redis`. */
export const REDIS = Symbol('REDIS');

const logger = new Logger('Redis');

/** Longest the startup waits for the first Redis connection. */
const STARTUP_WAIT_MS = 2_000;

/**
 * Owns the one Redis connection of the API (rate-limit counters, readiness).
 *
 * Redis is not on the critical path of any request: the API must keep answering
 * while it is down (rate limiting fails open, readiness reports it). So:
 * - startup waits at most 2 seconds for Redis, and a failed first connection is
 *   only logged;
 * - commands fail at once while disconnected (`enableOfflineQueue: false`) instead
 *   of queueing and making every request wait;
 * - the client keeps reconnecting in the background, at most every 2 seconds;
 * - connection errors are logged at `warn` once per outage, not once per retry.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>): Redis =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 2_000,
          retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleInit, OnApplicationShutdown {
  private down = false;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleInit(): Promise<void> {
    // Without a listener an 'error' event would crash the process.
    this.redis.on('error', (err: Error) => {
      if (this.down) return;
      this.down = true;
      logger.warn({ err: { message: err.message } }, 'Redis is unavailable');
    });
    this.redis.on('ready', () => {
      if (this.down) logger.log('Redis is available again');
      this.down = false;
    });
    // Wait briefly for the first connection, so requests right after startup are
    // already counted; never longer, and never fail: the API starts without Redis.
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      this.redis.connect().catch(() => {
        // Logged by the 'error' listener; ioredis keeps retrying.
      }),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STARTUP_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
