import type { ThrottlerOptions } from '@nestjs/throttler';
import { LOGIN_RATE_LIMIT } from '../http/rate-limit.decorators';

/** Names of the three limits; they prefix the Redis keys. */
export const RATE_LIMITS = ['anonymous', 'user', 'login'] as const;

/** The request fields the trackers read. */
export interface RateLimitedRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
  /** Set by the JWT guard after verification; absent for anonymous callers. */
  user?: { id: string };
  body?: unknown;
}

/** Limits per minute, from configuration. */
export interface RateLimitSettings {
  enabled: boolean;
  anonymousPerMinute: number;
  userPerMinute: number;
  loginPerMinute: number;
}

const MINUTE_MS = 60_000;

/** The client address as Express resolved it with `trust proxy`. */
export function clientIp(req: RateLimitedRequest): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Login attempts are counted per IP **and** email: one attacker cannot try many
 * passwords for one account, and one shared IP (a university NAT) does not lock
 * everyone else out. The email is lowercased and trimmed like at login, so case
 * variants share a counter. The library hashes the key, so Redis never holds the
 * email in clear.
 */
export function loginTracker(req: RateLimitedRequest): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  return `${clientIp(req)}|${email}`;
}

/**
 * The three throttlers of the API:
 * - `anonymous`: per IP, only for requests without a verified user;
 * - `user`: per user id, only for requests with one;
 * - `login`: per IP + email, only on routes marked `@LoginRateLimit()`.
 *
 * Each window is one minute and a client over the limit is blocked for the rest of
 * a minute. With `enabled: false` every throttler is skipped.
 */
export function rateLimitThrottlers(settings: RateLimitSettings): ThrottlerOptions[] {
  const off = !settings.enabled;
  const request = (context: { switchToHttp(): { getRequest<T>(): T } }) =>
    context.switchToHttp().getRequest<RateLimitedRequest>();
  return [
    {
      name: 'anonymous',
      ttl: MINUTE_MS,
      limit: settings.anonymousPerMinute,
      skipIf: (context) => off || request(context).user !== undefined,
      getTracker: (req) => clientIp(req as RateLimitedRequest),
    },
    {
      name: 'user',
      ttl: MINUTE_MS,
      limit: settings.userPerMinute,
      skipIf: (context) => off || request(context).user === undefined,
      getTracker: (req) => `user:${(req as RateLimitedRequest).user?.id ?? ''}`,
    },
    {
      name: 'login',
      ttl: MINUTE_MS,
      limit: settings.loginPerMinute,
      skipIf: (context) =>
        off || Reflect.getMetadata(LOGIN_RATE_LIMIT, context.getHandler()) !== true,
      getTracker: (req) => loginTracker(req as RateLimitedRequest),
    },
  ];
}
