import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { DomainEvent, DomainEventPublisher } from '../../shared/kernel';
import type { PgTransactionalAdapter } from '../database/pg-transactional-adapter';

/**
 * Subscribes a provider method to a domain event:
 *
 * ```ts
 * @OnDomainEvent('village.published')
 * async evict(event: VillagePublished) { ... }
 * ```
 *
 * Use it instead of `@OnEvent`: it lets errors reach the publisher, which logs
 * them with the event name, instead of the library swallowing them.
 */
export function OnDomainEvent(name: string): MethodDecorator {
  return OnEvent(name, { suppressErrors: false });
}

/**
 * The {@link DomainEventPublisher} of the running app, on `@nestjs/event-emitter`.
 *
 * - Inside a transaction, `publish` queues the event on the transaction
 *   (pg-transactional-adapter.ts) and returns. The event is delivered after
 *   `COMMIT`, and dropped on `ROLLBACK`, so no listener ever reacts to a
 *   change that did not happen.
 * - Outside a transaction, the event is delivered at once.
 *
 * Listeners run in process, concurrently, and are awaited before the request
 * finishes. A failing listener is logged at `error` (the line carries the
 * request ID like every log line of the request) and never changes the
 * response. Events are not persisted or retried; a transactional outbox is
 * out of scope for this project (docs/kernel.md, "Domain events").
 */
@Injectable()
export class EventEmitterDomainEventPublisher implements DomainEventPublisher {
  private readonly logger = new Logger('DomainEvents');

  constructor(
    private readonly emitter: EventEmitter2,
    private readonly txHost: TransactionHost<PgTransactionalAdapter>,
  ) {}

  publish(event: DomainEvent): Promise<void> {
    const queue = this.txHost.isTransactionActive() ? this.txHost.tx.afterCommit : undefined;
    if (queue) {
      queue.push(() => this.deliver(event));
      return Promise.resolve();
    }
    return this.deliver(event);
  }

  private async deliver(event: DomainEvent): Promise<void> {
    const listeners = this.emitter.listeners(event.name);
    // then() also turns a listener that throws synchronously into a rejection.
    const results = await Promise.allSettled(
      listeners.map((listener) => Promise.resolve().then(() => listener(event))),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error(
          { err: result.reason as unknown, event: event.name, aggregateId: event.aggregateId },
          'Domain event listener failed',
        );
      }
    }
  }
}
