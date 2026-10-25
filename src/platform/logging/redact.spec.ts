import { Writable } from 'node:stream';
import pino from 'pino';
import { createPinoOptions } from './logger-options';
import { REDACTED, redactDeep } from './redact';

/** A pino logger with the app's options that writes JSON lines into an array. */
function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  const logger = pino(createPinoOptions({ NODE_ENV: 'production', LOG_LEVEL: 'info' }), stream);
  return { logger, lines };
}

describe('log redaction', () => {
  it('redacts password hashes in both credential naming conventions', () => {
    const { logger, lines } = captureLogger();
    logger.info({ account: { passwordHash: 'camel-hash', password_hash: 'snake-hash' } });
    expect(lines[0]).toMatchObject({
      account: { passwordHash: REDACTED, password_hash: REDACTED },
    });
    expect(JSON.stringify(lines)).not.toMatch(/camel-hash|snake-hash/);
  });
  it('redacts credentials at any depth, keeping everything else', () => {
    const { logger, lines } = captureLogger();
    logger.info(
      {
        user: { email: 'a@example.org', password: 'p1', profile: { refreshToken: 'r1' } },
        login: {
          accessToken: 'a1',
          token: 't1',
          secret: 's1',
          clientSecret: 'c1',
          newPassword: 'n1',
        },
        attempts: [{ password: 'p2' }, { note: 'kept' }],
        req: {
          method: 'POST',
          headers: { authorization: 'Bearer x', cookie: 'sid=1', accept: 'json' },
        },
      },
      'login attempt',
    );

    const [line] = lines;
    expect(line).toMatchObject({
      msg: 'login attempt',
      user: { email: 'a@example.org', password: REDACTED, profile: { refreshToken: REDACTED } },
      login: {
        accessToken: REDACTED,
        token: REDACTED,
        secret: REDACTED,
        clientSecret: REDACTED,
        newPassword: REDACTED,
      },
      attempts: [{ password: REDACTED }, { note: 'kept' }],
      req: {
        method: 'POST',
        headers: { authorization: REDACTED, cookie: REDACTED, accept: 'json' },
      },
    });
    expect(JSON.stringify(line)).not.toMatch(/p1|r1|a1|t1|s1|c1|n1|p2|Bearer|sid=1/);
  });

  it('redacts the headers of a raw request logged whole', () => {
    const { logger, lines } = captureLogger();
    // Covered twice: by the key-based redaction and by pino's redact paths,
    // which also apply after pino's own req serializer has run.
    logger.info({
      req: { method: 'GET', url: '/', headers: { authorization: 'Bearer y', cookie: 'c' } },
    });
    expect(lines[0]).toMatchObject({
      req: { headers: { authorization: REDACTED, cookie: REDACTED } },
    });
  });
});

describe('redactDeep', () => {
  it('does not mutate its input', () => {
    const input = { password: 'p' };
    redactDeep(input);
    expect(input.password).toBe('p');
  });

  it('copes with cycles and keeps shared references', () => {
    const shared = { a: 1 };
    const cyclic: Record<string, unknown> = { left: shared, right: shared };
    cyclic.self = cyclic;
    expect(redactDeep(cyclic)).toEqual({ left: { a: 1 }, right: { a: 1 }, self: '[Circular]' });
  });

  it('leaves errors and other class instances to pino', () => {
    const error = new Error('x');
    expect(redactDeep({ err: error }).err).toBe(error);
  });
});
