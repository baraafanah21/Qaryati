import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { InjectModuleDb } from '../../../platform/database/database';
import type { AuditCursor } from '../domain/audit-cursor';
import type { AuditLogEntry, AuditLogFilter, AuditLogReader } from '../domain/audit-log';
import type { AuditDb } from './persistence/audit-db';
import { auditEntry } from './persistence/schema';

/**
 * Reads `audit_entry` newest first with a keyset on `(occurred_at, id)`.
 *
 * The row comparison `(occurred_at, id) < (cursor)` and the order
 * `occurred_at DESC, id DESC` match the four indexes of #20: with a village,
 * actor or entity filter the planner walks that index from the cursor; with
 * none, `audit_entry_occurred_idx`. Each page is one statement whose cost does
 * not grow with the page number, unlike OFFSET. `id` breaks ties between
 * entries recorded at the same instant, so none is skipped or repeated.
 */
@Injectable()
export class DrizzleAuditLogReader implements AuditLogReader {
  constructor(@InjectModuleDb() private readonly db: AuditDb) {}

  async list(
    filter: AuditLogFilter,
    after: AuditCursor | undefined,
    limit: number,
  ): Promise<AuditLogEntry[]> {
    const conditions: (SQL | undefined)[] = [
      filter.villageId === undefined ? undefined : eq(auditEntry.villageId, filter.villageId),
      filter.actorId === undefined ? undefined : eq(auditEntry.actorId, filter.actorId),
      filter.entityType === undefined ? undefined : eq(auditEntry.entityType, filter.entityType),
      filter.entityId === undefined ? undefined : eq(auditEntry.entityId, filter.entityId),
      filter.action === undefined ? undefined : eq(auditEntry.action, filter.action),
      filter.from === undefined ? undefined : gte(auditEntry.occurredAt, filter.from),
      filter.to === undefined ? undefined : lt(auditEntry.occurredAt, filter.to),
      after === undefined
        ? undefined
        : sql`(${auditEntry.occurredAt}, ${auditEntry.id}) < (${after.occurredAt.toISOString()}::timestamptz, ${after.id}::uuid)`,
    ];
    const rows = await this.db
      .select()
      .from(auditEntry)
      .where(and(...conditions))
      .orderBy(desc(auditEntry.occurredAt), desc(auditEntry.id))
      .limit(limit);
    return rows.map((row) => ({ ...row, before: row.before ?? null, after: row.after ?? null }));
  }
}
