import { Inject, Injectable, Logger } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { CLOCK, type AuditEntry, type AuditRecorder, type Clock } from '../../shared/kernel';
import { RequestContext } from '../context/request-context';
import type { PgTransactionalAdapter } from '../database/pg-transactional-adapter';

/**
 * Stand-in for the audit module's recorder until #20 lands: it checks the
 * port's contract (an active transaction) and logs each entry at `warn`
 * instead of storing it. Snapshots are not logged; they may hold personal data.
 *
 * TODO(#20): delete this class and AuditPlaceholderModule once the audit
 * module provides `AUDIT_RECORDER`.
 */
@Injectable()
export class PlaceholderAuditRecorder implements AuditRecorder {
  private readonly logger = new Logger('Audit');

  constructor(
    private readonly txHost: TransactionHost<PgTransactionalAdapter>,
    private readonly context: RequestContext,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  record(entry: AuditEntry): Promise<void> {
    if (!this.txHost.isTransactionActive()) {
      return Promise.reject(
        new Error(`AuditRecorder.record(${entry.action}) must run inside @Transactional().`),
      );
    }
    this.logger.warn(
      {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        villageId: entry.villageId,
        actorId: this.context.actorId,
        occurredAt: this.clock.now().toISOString(),
      },
      'audit persistence not implemented yet (#20)',
    );
    return Promise.resolve();
  }
}
