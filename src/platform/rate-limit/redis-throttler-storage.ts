import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';

/** What the throttler guard needs back from one counted request. */
export interface ThrottlerStorageRecord {
  totalHits: number;
  /** Seconds until the counting window ends. */
  timeToExpire: number;
  isBlocked: boolean;
  /** Seconds until the block ends; sent as `Retry-After`. */
  timeToBlockExpire: number;
}

const KEY_PREFIX = 'qaryati:throttle:';

/**
 * One round trip, atomic: a fixed window counter (`INCR`, expiry set on the first
 * hit) plus a block key set when the limit is passed. While the block key lives,
 * requests are refused without counting, so a client that keeps hammering is not
 * blocked longer than `blockDuration`.
 *
 * Returns { hits, windowMs, blocked (0|1), blockMs }.
 */
const SCRIPT = `
local blockMs = redis.call('PTTL', KEYS[2])
if blockMs > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  return { hits, math.max(redis.call('PTTL', KEYS[1]), 0), 1, blockMs }
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local windowMs = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return { hits, windowMs, 1, tonumber(ARGV[3]) }
end
return { hits, windowMs, 0, 0 }
`;

/** How often the fail-open warning may repeat while Redis stays down. */
const WARN_EVERY_MS = 30_000;

/**
 * `ThrottlerStorage` over the shared ioredis client, so every API instance counts
 * against the same limits.
 *
 * Written here (about 40 lines) because the maintained Redis storage package does
 * not support NestJS 12 yet (docs/tech-stack.md).
 *
 * **Fails open:** when Redis cannot be reached the request is let through and a
 * warning is logged (at most every 30 seconds). Qaryati is mostly a public read
 * API: refusing every request because the counter store is down would turn a Redis
 * outage into a full outage. The cost is that limits are not enforced during the
 * outage; the account lockout still protects passwords, because it is stored in
 * PostgreSQL.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private lastWarning = 0;

  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${KEY_PREFIX}${throttlerName}:${key}`;
    try {
      const reply = (await this.redis.eval(
        SCRIPT,
        2,
        base,
        `${base}:blocked`,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];
      const [hits, windowMs, blocked, blockMs] = reply;
      return {
        totalHits: hits,
        timeToExpire: Math.ceil(windowMs / 1000),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.ceil(blockMs / 1000),
      };
    } catch (error) {
      this.warnFailOpen(error);
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  private warnFailOpen(error: unknown): void {
    // Platform code: the wall clock only paces a log line, it decides nothing.
    const now = Date.now();
    if (now - this.lastWarning < WARN_EVERY_MS) return;
    this.lastWarning = now;
    this.logger.warn(
      { err: { message: error instanceof Error ? error.message : String(error) } },
      'Rate limiting skipped: Redis is unavailable (failing open)',
    );
  }
}
