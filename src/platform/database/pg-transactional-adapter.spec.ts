import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { runInTransaction, type DbConnection } from './pg-transactional-adapter';

/** A pool with one client that records what happens to it. */
function fakePool(options: { failOn?: string } = {}) {
  const log: string[] = [];
  const client = {
    query: jest.fn((text: string) => {
      log.push(text);
      return text === options.failOn
        ? Promise.reject(new Error(`${text} failed`))
        : Promise.resolve({ rows: [] });
    }),
    release: jest.fn((destroy?: Error) => log.push(destroy ? 'release(destroy)' : 'release')),
  };
  const pool = { connect: jest.fn(() => Promise.resolve(client)) } as unknown as Pool;
  return { pool, client, log };
}

/** Records every value the transaction host would hold. */
function recordTx() {
  const values: (DbConnection | undefined)[] = [];
  return { values, setTx: (tx?: DbConnection) => values.push(tx) };
}

describe('runInTransaction', () => {
  it('runs BEGIN, the work and COMMIT on one client, then releases it', async () => {
    const { pool, client, log } = fakePool();
    const { values, setTx } = recordTx();
    const result = await runInTransaction(pool, () => Promise.resolve(42), setTx);
    expect(result).toBe(42);
    expect(log).toEqual(['BEGIN', 'COMMIT', 'release']);
    expect(values[0]?.client).toBe(client);
    expect(values.at(-1)).toBeUndefined();
  });

  it('rolls back, releases and rethrows when the work throws', async () => {
    const { pool, log } = fakePool();
    const boom = new Error('boom');
    await expect(runInTransaction(pool, () => Promise.reject(boom), recordTx().setTx)).rejects.toBe(
      boom,
    );
    expect(log).toEqual(['BEGIN', 'ROLLBACK', 'release']);
  });

  it('rolls back when COMMIT fails', async () => {
    const { pool, log } = fakePool({ failOn: 'COMMIT' });
    await expect(
      runInTransaction(pool, () => Promise.resolve(1), recordTx().setTx),
    ).rejects.toThrow('COMMIT failed');
    expect(log).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK', 'release']);
  });

  it('destroys the client when ROLLBACK fails, and keeps the original error', async () => {
    const { pool, log } = fakePool({ failOn: 'ROLLBACK' });
    await expect(
      runInTransaction(pool, () => Promise.reject(new Error('boom')), recordTx().setTx),
    ).rejects.toThrow('boom');
    expect(log.at(-1)).toBe('release(destroy)');
  });

  it('runs after-commit callbacks after COMMIT, outside the transaction', async () => {
    const { pool, log } = fakePool();
    const { values, setTx } = recordTx();
    await runInTransaction(
      pool,
      () => {
        values[0]?.afterCommit?.push(() => {
          log.push(`callback (tx cleared: ${values.at(-1) === undefined})`);
        });
        return Promise.resolve();
      },
      setTx,
    );
    expect(log).toEqual(['BEGIN', 'COMMIT', 'release', 'callback (tx cleared: true)']);
  });

  it('skips after-commit callbacks on rollback', async () => {
    const { pool } = fakePool();
    const { values, setTx } = recordTx();
    const callback = jest.fn();
    await expect(
      runInTransaction(
        pool,
        () => {
          values[0]?.afterCommit?.push(callback);
          return Promise.reject(new Error('boom'));
        },
        setTx,
      ),
    ).rejects.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });

  it('logs a failing after-commit callback and still returns the result', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const { pool } = fakePool();
      const { values, setTx } = recordTx();
      const second = jest.fn();
      const result = await runInTransaction(
        pool,
        () => {
          values[0]?.afterCommit?.push(() => Promise.reject(new Error('listener')), second);
          return Promise.resolve('done');
        },
        setTx,
      );
      expect(result).toBe('done');
      expect(second).toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) as Error }),
        'After-commit callback failed',
      );
    } finally {
      error.mockRestore();
    }
  });
});
