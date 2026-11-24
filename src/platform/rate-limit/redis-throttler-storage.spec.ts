import type Redis from 'ioredis';
import { RedisThrottlerStorage } from './redis-throttler-storage';

describe('RedisThrottlerStorage', () => {
  it('converts the script reply into seconds', async () => {
    const redis = { eval: jest.fn().mockResolvedValue([6, 41_200, 1, 60_000]) };
    const storage = new RedisThrottlerStorage(redis as unknown as Redis);
    await expect(storage.increment('k', 60_000, 5, 60_000, 'login')).resolves.toEqual({
      totalHits: 6,
      timeToExpire: 42,
      isBlocked: true,
      timeToBlockExpire: 60,
    });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'qaryati:throttle:login:k',
      'qaryati:throttle:login:k:blocked',
      60_000,
      5,
      60_000,
    );
  });

  it('fails open when Redis is unavailable', async () => {
    const redis = { eval: jest.fn().mockRejectedValue(new Error('Connection is closed.')) };
    const storage = new RedisThrottlerStorage(redis as unknown as Redis);
    await expect(storage.increment('k', 60_000, 5, 60_000, 'anonymous')).resolves.toEqual({
      totalHits: 0,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });
});
