import { Inject, Injectable } from '@nestjs/common';
import { FieldErrorCode, ValidationError } from '../../../shared/kernel';
import { decodeAuditCursor, encodeAuditCursor } from '../domain/audit-cursor';
import {
  AUDIT_LOG_READER,
  type AuditLogEntry,
  type AuditLogFilter,
  type AuditLogReader,
} from '../domain/audit-log';
import {
  AUDIT_SNAPSHOT_POLICY,
  readableSnapshot,
  type SnapshotPolicy,
} from '../domain/snapshot-policy';

/** One page of the audit trail; `nextCursor` is null on the last page. */
export interface AuditLogPage {
  content: AuditLogEntry[];
  nextCursor: string | null;
}

export interface ListAuditEntriesInput {
  filter: AuditLogFilter;
  /** The `nextCursor` of the previous page; absent for the first page. */
  cursor?: string;
  limit: number;
}

/**
 * Reads the audit trail (#44): newest first, keyset pagination on
 * `(occurred_at, id)`. It reads one entry more than asked to know whether a
 * next page exists, without a count query. Read-only: no transaction, no
 * audit entry of its own.
 */
@Injectable()
export class ListAuditEntries {
  constructor(
    @Inject(AUDIT_LOG_READER) private readonly reader: AuditLogReader,
    @Inject(AUDIT_SNAPSHOT_POLICY) private readonly policy: SnapshotPolicy,
  ) {}

  async execute(input: ListAuditEntriesInput): Promise<AuditLogPage> {
    const after = input.cursor === undefined ? undefined : decodeAuditCursor(input.cursor);
    if (input.cursor !== undefined && after === undefined) {
      throw new ValidationError('The cursor is invalid.', [
        {
          field: 'cursor',
          code: FieldErrorCode.INVALID_FORMAT,
          message: 'Use the nextCursor of a previous page.',
        },
      ]);
    }
    const { from, to } = input.filter;
    if (from !== undefined && to !== undefined && from >= to) {
      throw new ValidationError('The time range is empty.', [
        { field: 'to', code: FieldErrorCode.INVALID_VALUE, message: '`to` must be after `from`.' },
      ]);
    }

    const rows = await this.reader.list(input.filter, after, input.limit + 1);
    const content = rows.slice(0, input.limit).map((entry) => ({
      ...entry,
      before: readableSnapshot(this.policy, entry.entityType, entry.before),
      after: readableSnapshot(this.policy, entry.entityType, entry.after),
    }));
    const last = content.at(-1);
    return {
      content,
      nextCursor:
        rows.length > input.limit && last
          ? encodeAuditCursor({ occurredAt: last.occurredAt, id: last.id })
          : null,
    };
  }
}
