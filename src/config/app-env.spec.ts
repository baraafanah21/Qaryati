import { appEnvSchema } from './app-env';
import { parseAccessTokenTtl } from './access-token-ttl';

const DATABASE_URL = 'postgres://qaryati_app:secret@localhost:5432/qaryati';
const JWT = { JWT_PRIVATE_KEY_FILE: 'private.pem', JWT_PUBLIC_KEY_FILE: 'public.pem' };

describe('appEnvSchema', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(appEnvSchema.parse({ DATABASE_URL, ...JWT })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_URL,
      ...JWT,
      JWT_ISSUER: 'qaryati',
      JWT_ACCESS_TTL: '15m',
    });
  });

  it.each([
    ['15m', 900],
    ['45s', 45],
    ['2h', 7200],
  ])('parses JWT_ACCESS_TTL=%s into %i seconds', (value, seconds) => {
    const ttl = appEnvSchema.parse({ DATABASE_URL, ...JWT, JWT_ACCESS_TTL: value }).JWT_ACCESS_TTL;
    expect(ttl).toBe(value);
    expect(parseAccessTokenTtl(ttl)).toBe(seconds);
  });

  it.each([
    '',
    '0m',
    '-1m',
    '1.5m',
    '15',
    '15ms',
    '1d',
    '15M',
    ' 15m ',
    'Infinity',
    '9007199254740991h',
  ])('rejects invalid JWT_ACCESS_TTL=%j', (value) => {
    const result = appEnvSchema.safeParse({ DATABASE_URL, ...JWT, JWT_ACCESS_TTL: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['JWT_ACCESS_TTL']);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    const result = appEnvSchema.safeParse({ DATABASE_URL, LOG_LEVEL: 'verbose' });
    expect(result.error?.issues[0]?.path).toEqual(['LOG_LEVEL']);
  });

  it('turns PORT from a string into a number', () => {
    expect(appEnvSchema.parse({ DATABASE_URL, ...JWT, PORT: '8080' }).PORT).toBe(8080);
  });

  it.each(['0', '70000', 'abc', '3.5'])('rejects PORT=%s', (port) => {
    const result = appEnvSchema.safeParse({ DATABASE_URL, PORT: port });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['PORT']);
  });

  it.each([
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
  ])('reads SWAGGER_ENABLED=%s as %p', (value, expected) => {
    expect(
      appEnvSchema.parse({ DATABASE_URL, ...JWT, SWAGGER_ENABLED: value }).SWAGGER_ENABLED,
    ).toBe(expected);
  });

  it('treats an empty SWAGGER_ENABLED as unset', () => {
    expect(
      appEnvSchema.parse({ DATABASE_URL, ...JWT, SWAGGER_ENABLED: '' }).SWAGGER_ENABLED,
    ).toBeUndefined();
  });

  it('rejects SWAGGER_ENABLED=maybe', () => {
    const result = appEnvSchema.safeParse({ DATABASE_URL, ...JWT, SWAGGER_ENABLED: 'maybe' });
    expect(result.error?.issues[0]).toMatchObject({
      path: ['SWAGGER_ENABLED'],
      message: 'must be true or false',
    });
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(appEnvSchema.safeParse({ DATABASE_URL, NODE_ENV: 'staging' }).success).toBe(false);
  });

  it('requires DATABASE_URL', () => {
    const result = appEnvSchema.safeParse({ ...JWT });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['DATABASE_URL'], message: 'is required' }),
    ]);
  });

  it.each(['mysql://u:p@localhost/qaryati', 'localhost:5432', ''])(
    'rejects DATABASE_URL=%j',
    (url) => {
      const result = appEnvSchema.safeParse({ DATABASE_URL: url, ...JWT });
      expect(result.error?.issues).toEqual([
        expect.objectContaining({
          path: ['DATABASE_URL'],
          message: 'must be a postgres:// connection URL',
        }),
      ]);
    },
  );

  it.each(['JWT_PRIVATE_KEY_FILE', 'JWT_PUBLIC_KEY_FILE'])('requires %s', (field) => {
    const input: Record<string, unknown> = { DATABASE_URL, ...JWT };
    delete input[field];
    expect(appEnvSchema.safeParse(input).error?.issues).toEqual([
      expect.objectContaining({ path: [field], message: 'is required' }),
    ]);
  });

  it.each(['JWT_PRIVATE_KEY_FILE', 'JWT_PUBLIC_KEY_FILE', 'JWT_ISSUER'])(
    'rejects empty %s',
    (field) => {
      expect(appEnvSchema.safeParse({ DATABASE_URL, ...JWT, [field]: '' }).error?.issues).toEqual([
        expect.objectContaining({ path: [field], message: 'must not be empty' }),
      ]);
    },
  );
});
