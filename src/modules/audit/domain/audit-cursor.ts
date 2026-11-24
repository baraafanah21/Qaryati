/**
 * The position after which the next page of the audit trail starts: the
 * `(occurred_at, id)` of the last entry of the previous page. Pages run newest
 * first, so the next page holds the entries strictly before this key.
 */
export interface AuditCursor {
  occurredAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The opaque `cursor` a client sends back: base64url of `[isoTime, id]`.
 * Opaque so clients do not build cursors themselves and the format may
 * change; not signed, because it only says where to start reading, and every
 * value it can hold is a valid place to start.
 */
export function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(JSON.stringify([cursor.occurredAt.toISOString(), cursor.id])).toString(
    'base64url',
  );
}

/** The cursor in `raw`, or `undefined` when it is not one this API issued. */
export function decodeAuditCursor(raw: string): AuditCursor | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
  const [time, id] = parsed as unknown[];
  if (typeof time !== 'string' || typeof id !== 'string' || !UUID.test(id)) return undefined;
  const occurredAt = new Date(time);
  // Only the exact form encode writes: a round trip must give the same text.
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.toISOString() !== time) return undefined;
  return { occurredAt, id };
}
