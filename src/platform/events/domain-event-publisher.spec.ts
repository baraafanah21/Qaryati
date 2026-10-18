import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { TransactionHost } from '@nestjs-cls/transactional';
import type { DomainEvent } from '../../shared/kernel';
import type {
  AfterCommitCallback,
  PgTransactionalAdapter,
} from '../database/pg-transactional-adapter';
import { EventEmitterDomainEventPublisher } from './domain-event-publisher';

const event: DomainEvent = {
  name: 'village.published',
  occurredAt: new Date('2026-10-18T10:00:00Z'),
  aggregateId: 'v1',
  payload: {},
};

function setup(inTransaction: boolean, listeners: Array<(e: DomainEvent) => unknown>) {
  const afterCommit: AfterCommitCallback[] = [];
  const txHost = {
    isTransactionActive: () => inTransaction,
    tx: { client: {}, afterCommit },
  } as unknown as TransactionHost<PgTransactionalAdapter>;
  const emitter = { listeners: () => listeners } as unknown as EventEmitter2;
  return { publisher: new EventEmitterDomainEventPublisher(emitter, txHost), afterCommit };
}

describe('EventEmitterDomainEventPublisher', () => {
  it('delivers at once outside a transaction', async () => {
    const listener = jest.fn();
    const { publisher } = setup(false, [listener]);
    await publisher.publish(event);
    expect(listener).toHaveBeenCalledWith(event);
  });

  it('queues the event on the transaction and delivers it only when the queue runs', async () => {
    const listener = jest.fn();
    const { publisher, afterCommit } = setup(true, [listener]);
    await publisher.publish(event);
    expect(listener).not.toHaveBeenCalled();
    expect(afterCommit).toHaveLength(1);
    await afterCommit[0]?.();
    expect(listener).toHaveBeenCalledWith(event);
  });

  it('logs each failing listener, runs the others and never throws', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const healthy = jest.fn();
      const { publisher } = setup(false, [
        () => Promise.reject(new Error('a')),
        healthy,
        () => {
          throw new Error('b');
        },
      ]);
      await expect(publisher.publish(event)).resolves.toBeUndefined();
      expect(healthy).toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(2);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'village.published', aggregateId: 'v1' }),
        'Domain event listener failed',
      );
    } finally {
      error.mockRestore();
    }
  });
});
