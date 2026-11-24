import type { ExecutionContext } from '@nestjs/common';
import { LOGIN_RATE_LIMIT } from '../http/rate-limit.decorators';
import {
  clientIp,
  loginTracker,
  rateLimitThrottlers,
  type RateLimitedRequest,
} from './rate-limit-policy';

const settings = { enabled: true, anonymousPerMinute: 120, userPerMinute: 300, loginPerMinute: 5 };

function context(req: RateLimitedRequest, login = false): ExecutionContext {
  const handler = () => undefined;
  if (login) Reflect.defineMetadata(LOGIN_RATE_LIMIT, true, handler);
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

function skipped(
  enabled: boolean,
  req: RateLimitedRequest,
  login = false,
): Record<string, unknown> {
  const entries: [string, unknown][] = rateLimitThrottlers({ ...settings, enabled }).map((t) => [
    t.name ?? '',
    t.skipIf?.(context(req, login)),
  ]);
  return Object.fromEntries(entries);
}

describe('rate-limit policy', () => {
  it('configures one-minute windows with the configured limits', () => {
    expect(
      rateLimitThrottlers(settings).map(({ name, ttl, limit }) => ({ name, ttl, limit })),
    ).toEqual([
      { name: 'anonymous', ttl: 60_000, limit: 120 },
      { name: 'user', ttl: 60_000, limit: 300 },
      { name: 'login', ttl: 60_000, limit: 5 },
    ]);
  });

  it('limits a caller without a user per IP only', () => {
    expect(skipped(true, { ip: '1.2.3.4' })).toEqual({
      anonymous: false,
      user: true,
      login: true,
    });
  });

  it('limits a verified user per user only', () => {
    expect(skipped(true, { ip: '1.2.3.4', user: { id: 'u1' } })).toEqual({
      anonymous: true,
      user: false,
      login: true,
    });
  });

  it('adds the login limit only on routes marked @LoginRateLimit()', () => {
    expect(skipped(true, { ip: '1.2.3.4' }, true).login).toBe(false);
  });

  it('skips everything when disabled', () => {
    expect(skipped(false, { ip: '1.2.3.4' }, true)).toEqual({
      anonymous: true,
      user: true,
      login: true,
    });
  });

  it('keys login attempts by IP and normalized email', () => {
    expect(loginTracker({ ip: '1.2.3.4', body: { email: '  A@Example.TEST ' } })).toBe(
      '1.2.3.4|a@example.test',
    );
    expect(loginTracker({ ip: '1.2.3.4', body: { email: 42 } })).toBe('1.2.3.4|');
    expect(loginTracker({ ip: '1.2.3.4' })).toBe('1.2.3.4|');
  });

  it('keys users by id and anonymous callers by the resolved IP', () => {
    const [anonymous, user] = rateLimitThrottlers(settings);
    const ctx = context({});
    expect(anonymous?.getTracker?.({ ip: '9.9.9.9' }, ctx)).toBe('9.9.9.9');
    expect(user?.getTracker?.({ user: { id: 'u1' } }, ctx)).toBe('user:u1');
    expect(clientIp({ socket: { remoteAddress: '::1' } })).toBe('::1');
  });
});
