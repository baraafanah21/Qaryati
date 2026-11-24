import type { Response } from 'express';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { HealthController } from './health.controller';

function controller(db: () => Promise<unknown>, redis: () => Promise<unknown>) {
  return new HealthController(
    { query: db } as unknown as Pool,
    {
      ping: redis,
    } as unknown as Redis,
  );
}

function response() {
  const res = { statusCode: 200, status: jest.fn() };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  return res;
}

const up = () => Promise.resolve('ok');
const down = () => Promise.reject(new Error('connection refused'));

describe('HealthController', () => {
  it('reports the process as alive without touching dependencies', () => {
    const db = jest.fn(up);
    expect(controller(db, up).live()).toEqual({ status: 'ok' });
    expect(db).not.toHaveBeenCalled();
  });

  it('is ready when PostgreSQL and Redis answer', async () => {
    const res = response();
    await expect(controller(up, up).ready(res as unknown as Response)).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ['database', down, up],
    ['redis', up, down],
  ] as const)('answers 503 naming %s when it is down', async (name, db, redis) => {
    const res = response();
    const body = await controller(db, redis).ready(res as unknown as Response);
    expect(res.statusCode).toBe(503);
    expect(body.status).toBe('unavailable');
    expect(body.checks[name]).toBe('down');
  });

  it('counts a dependency that hangs as down after a second', async () => {
    jest.useFakeTimers();
    try {
      const res = response();
      const pending = controller(() => new Promise(() => undefined), up).ready(
        res as unknown as Response,
      );
      await jest.advanceTimersByTimeAsync(1_000);
      expect((await pending).checks.database).toBe('down');
      expect(res.statusCode).toBe(503);
    } finally {
      jest.useRealTimers();
    }
  });
});
