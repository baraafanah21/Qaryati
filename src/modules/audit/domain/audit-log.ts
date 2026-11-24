import type { AuditCursor } from './audit-cursor';

/** One stored audit entry, as the read APIs return it (#44). */
export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  villageId: string | null;
  actorId: string | null;
  requestId: string | null;
  occurredAt: Date;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** Filters of the audit trail; every given filter must match. */
export interface AuditLogFilter {
  villageId?: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  /** Inclusive. */
  from?: Date;
  /** Exclusive. */
  to?: Date;
}

/** Page sizes of the audit read APIs. */
export const AUDIT_PAGE_SIZE = { default: 20, max: 100 } as const;

/**
 * Read port of `audit_entry`. Newest first, by `(occurred_at, id)` descending;
 * with `after`, only the entries strictly before that key (keyset pagination).
 */
export interface AuditLogReader {
  list(
    filter: AuditLogFilter,
    after: AuditCursor | undefined,
    limit: number,
  ): Promise<AuditLogEntry[]>;
}

/** Injection token of the {@link AuditLogReader}. */
export const AUDIT_LOG_READER = Symbol('AUDIT_LOG_READER');
