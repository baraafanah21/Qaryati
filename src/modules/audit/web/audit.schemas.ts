import { z } from 'zod';
import { FieldErrorCode } from '../../../shared/kernel';
import { decodeAuditCursor } from '../domain/audit-cursor';
import { AUDIT_PAGE_SIZE } from '../domain/audit-log';

/** `?cursor=&limit=`: keyset pagination, newest first. A cursor we did not issue is a 400. */
const keysetQuery = {
  cursor: z
    .string()
    .min(1)
    .max(200)
    .refine((raw) => decodeAuditCursor(raw) !== undefined, {
      params: { code: FieldErrorCode.INVALID_FORMAT },
      message: 'Use the nextCursor of a previous page.',
    })
    .optional()
    .meta({ description: 'The nextCursor of the previous page; omit for the first page.' }),
  limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_SIZE.max).default(AUDIT_PAGE_SIZE.default),
};

export const historyLogQuery = z.strictObject(keysetQuery);
export type HistoryLogQuery = z.infer<typeof historyLogQuery>;

export const auditQuery = z
  .strictObject({
    ...keysetQuery,
    actorId: z.uuid().optional(),
    entityType: z.string().min(1).max(100).optional(),
    entityId: z.string().min(1).max(200).optional(),
    action: z.string().min(1).max(100).optional(),
    from: z.iso
      .datetime({ offset: true })
      .optional()
      .meta({ description: 'Inclusive lower bound of occurredAt (ISO 8601).' }),
    to: z.iso
      .datetime({ offset: true })
      .optional()
      .meta({ description: 'Exclusive upper bound of occurredAt (ISO 8601).' }),
  })
  .refine(
    (q) => q.from === undefined || q.to === undefined || Date.parse(q.from) < Date.parse(q.to),
    {
      path: ['to'],
      params: { code: FieldErrorCode.INVALID_VALUE },
      message: '`to` must be after `from`.',
    },
  );
export type AuditQuery = z.infer<typeof auditQuery>;

const auditEntryResponse = z
  .strictObject({
    id: z.uuid(),
    action: z.string(),
    entityType: z.string(),
    entityId: z.string(),
    villageId: z.uuid().nullable(),
    actorId: z.uuid().nullable(),
    requestId: z.string().nullable(),
    occurredAt: z.iso.datetime(),
    before: z
      .record(z.string(), z.unknown())
      .nullable()
      .meta({ description: 'Only the fields of the snapshot allow-list of entityType.' }),
    after: z
      .record(z.string(), z.unknown())
      .nullable()
      .meta({ description: 'Only the fields of the snapshot allow-list of entityType.' }),
  })
  .meta({ id: 'AuditEntryResponse' });

export const auditPageResponse = z
  .strictObject({
    content: z.array(auditEntryResponse),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: 'Send as ?cursor= for the next page; null on the last page.' }),
  })
  .meta({ id: 'AuditEntryPage' });
