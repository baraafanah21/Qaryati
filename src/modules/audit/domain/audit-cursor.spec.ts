import { decodeAuditCursor, encodeAuditCursor, type AuditCursor } from './audit-cursor';

const cursor: AuditCursor = {
  occurredAt: new Date('2026-11-20T08:15:30.123Z'),
  id: '019a0000-0000-7000-8000-000000000044',
};

describe('audit cursor', () => {
  it('round-trips through an opaque, URL-safe string', () => {
    const encoded = encodeAuditCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeAuditCursor(encoded)).toEqual(cursor);
  });

  it('keeps millisecond precision, so equal-second entries stay apart', () => {
    const next = { ...cursor, occurredAt: new Date('2026-11-20T08:15:30.124Z') };
    expect(decodeAuditCursor(encodeAuditCursor(next))?.occurredAt.getTime()).toBe(
      cursor.occurredAt.getTime() + 1,
    );
  });

  it.each([
    ['empty', ''],
    ['not base64 JSON', 'not-a-cursor'],
    ['a JSON object', Buffer.from('{"a":1}').toString('base64url')],
    ['one element', Buffer.from('["2026-11-20T08:15:30.123Z"]').toString('base64url')],
    ['a bad id', Buffer.from('["2026-11-20T08:15:30.123Z","x"]').toString('base64url')],
    [
      'an upper-case id',
      Buffer.from('["2026-11-20T08:15:30.123Z","019A0000-0000-7000-8000-000000000044"]').toString(
        'base64url',
      ),
    ],
    [
      'a bad time',
      Buffer.from('["yesterday","019a0000-0000-7000-8000-000000000044"]').toString('base64url'),
    ],
    [
      'a time not in the encoded form',
      Buffer.from('["2026-11-20","019a0000-0000-7000-8000-000000000044"]').toString('base64url'),
    ],
    ['numbers', Buffer.from('[1,2]').toString('base64url')],
  ])('rejects %s', (_, raw) => {
    expect(decodeAuditCursor(raw)).toBeUndefined();
  });
});
