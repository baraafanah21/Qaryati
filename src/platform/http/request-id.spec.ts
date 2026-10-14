import type { IncomingMessage, ServerResponse } from 'node:http';
import { validate as isUuid, version as uuidVersion } from 'uuid';
import { resolveRequestId } from './request-id';

function fakeRequest(header?: string): IncomingMessage {
  return { headers: header === undefined ? {} : { 'x-request-id': header } } as IncomingMessage;
}

function fakeResponse() {
  const headers: Record<string, string> = {};
  const res = {
    headersSent: false,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as ServerResponse;
  return { res, headers };
}

describe('resolveRequestId', () => {
  it.each(['0192f0c4-8e1a-7c3b-9d2e-5f6a7b8c9d0e', 'abcDEF12-trace', 'a'.repeat(64)])(
    'keeps a safe incoming id %s and echoes it',
    (incoming) => {
      const { res, headers } = fakeResponse();
      expect(resolveRequestId(fakeRequest(incoming), res)).toBe(incoming);
      expect(headers['X-Request-Id']).toBe(incoming);
    },
  );

  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(65)],
    ['spaces', 'hello world 123'],
    ['a line break', 'abcdefgh\r\nSet-Cookie: x=1'],
    ['empty', ''],
  ])('replaces an id with %s by a new UUIDv7', (_label, incoming) => {
    const id = resolveRequestId(fakeRequest(incoming));
    expect(isUuid(id)).toBe(true);
    expect(uuidVersion(id)).toBe(7);
  });

  it('creates a UUIDv7 when no header is sent', () => {
    expect(uuidVersion(resolveRequestId(fakeRequest()))).toBe(7);
  });

  it('returns the same id on every later call for the same request', () => {
    const req = fakeRequest();
    const first = resolveRequestId(req);
    expect(resolveRequestId(req)).toBe(first);
  });
});
