import { Inject, Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { RequestContext } from '../../../platform/context/request-context';
import { InjectModuleDb } from '../../../platform/database/database';
import type { PgTransactionalAdapter } from '../../../platform/database/pg-transactional-adapter';
import {
  CLOCK,
  ID_GENERATOR,
  type AuditEntry,
  type AuditRecorder,
  type Clock,
  type IdGenerator,
} from '../../../shared/kernel';
import {
  AUDIT_SNAPSHOT_POLICY,
  applySnapshotPolicy,
  type SnapshotPolicy,
} from '../domain/snapshot-policy';
import type { AuditDb } from './persistence/audit-db';
import { auditEntry } from './persistence/schema';

/**
 * Stores audit entries in `audit_entry`, through the audit module's Drizzle
 * handle. The handle joins the caller's `@Transactional()` transaction, so the
 * entry commits or rolls back with the change it describes.
 *
 * It fills `actorId` and `requestId` from {@link RequestContext}, `occurredAt`
 * from the `Clock` and `id` from the `IdGenerator`, and filters `before` and
 * `after` through the snapshot allow-list.
 */
@Injectable()
export class DrizzleAuditRecorder implements AuditRecorder {
  constructor(
    @InjectModuleDb() private readonly db: AuditDb,
    private readonly txHost: TransactionHost<PgTransactionalAdapter>,
    private readonly context: RequestContext,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(AUDIT_SNAPSHOT_POLICY) private readonly policy: SnapshotPolicy,
  ) {}

  /**
   * @throws Error outside `@Transactional()`: without a transaction the entry
   *   could commit while the change rolls back, or the other way round.
   * @throws Error for an entity type without a snapshot allow-list.
   */
  async record(entry: AuditEntry): Promise<void> {
    if (!this.txHost.isTransactionActive()) {
      throw new Error(`AuditRecorder.record(${entry.action}) must run inside @Transactional().`);
    }
    await this.db.insert(auditEntry).values({
      id: this.ids.next<'AuditEntry'>(),
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      villageId: entry.villageId ?? null,
      actorId: this.context.actorId ?? null,
      requestId: this.context.requestId ?? null,
      occurredAt: this.clock.now(),
      before: applySnapshotPolicy(this.policy, entry.entityType, entry.before) ?? null,
      after: applySnapshotPolicy(this.policy, entry.entityType, entry.after) ?? null,
    });
  }
}
