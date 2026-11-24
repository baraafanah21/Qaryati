import { appEnvSchema } from './app-env';
import { parseAccessTokenTtl } from './access-token-ttl';
import { parseRefreshTokenTtl } from './refresh-token-ttl';

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
      JWT_REFRESH_TTL: '7d',
      ADMIN_UNITS_CACHE_TTL_SECONDS: 3600,
      PRODUCTS_CACHE_TTL_SECONDS: 3600,
      GEO_PROVIDER: 'stub',
      GEO_NOMINATIM_URL: 'https://nominatim.openstreetmap.org',
      GEO_TIMEOUT_MS: 5000,
      GEO_RETRY_BASE_MS: 200,
      GEO_BREAKER_THRESHOLD: 5,
      GEO_BREAKER_HALF_OPEN_MS: 30000,
      GEO_MIN_INTERVAL_MS: 1000,
      GEO_QUEUE_TIMEOUT_MS: 5000,
      GEO_CACHE_TTL_SECONDS: 2592000,
      GEO_CACHE_EMPTY_TTL_SECONDS: 86400,
      REDIS_URL: 'redis://localhost:6379',
      RATE_LIMIT_ENABLED: true,
      RATE_LIMIT_ANONYMOUS_PER_MINUTE: 120,
      RATE_LIMIT_USER_PER_MINUTE: 300,
      RATE_LIMIT_LOGIN_PER_MINUTE: 5,
      CORS_ORIGINS: [],
      TRUST_PROXY: false,
      METRICS_PORT: 9464,
    });
  });

  describe('security and operations (#25, #42, #43)', () => {
    const parse = (extra: Record<string, unknown>) =>
      appEnvSchema.safeParse({ DATABASE_URL, ...JWT, ...extra });

    it('splits CORS_ORIGINS into bare origins, ignoring blanks', () => {
      expect(
        parse({ CORS_ORIGINS: ' http://localhost:5173 , ,https://qaryati.example' }).data
          ?.CORS_ORIGINS,
      ).toEqual(['http://localhost:5173', 'https://qaryati.example']);
      expect(parse({ CORS_ORIGINS: '' }).data?.CORS_ORIGINS).toEqual([]);
    });

    it.each(['https://qaryati.example/', 'https://qaryati.example/app', 'ftp://x.example', '*'])(
      'rejects CORS_ORIGINS=%j',
      (value) => {
        expect(parse({ CORS_ORIGINS: value }).error?.issues[0]?.path?.[0]).toBe('CORS_ORIGINS');
      },
    );

    it.each([
      ['false', false],
      ['', false],
      ['1', 1],
      ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'],
    ])('reads TRUST_PROXY=%j as %j', (value, expected) => {
      expect(parse({ TRUST_PROXY: value }).data?.TRUST_PROXY).toEqual(expected);
    });

    it('refuses TRUST_PROXY=true, which would let any client choose its IP', () => {
      expect(parse({ TRUST_PROXY: 'true' }).error?.issues[0]?.path).toEqual(['TRUST_PROXY']);
    });

    it.each([
      ['RATE_LIMIT_LOGIN_PER_MINUTE', '0'],
      ['RATE_LIMIT_USER_PER_MINUTE', '1.5'],
      ['RATE_LIMIT_ENABLED', 'maybe'],
      ['METRICS_PORT', '70000'],
      ['REDIS_URL', 'http://localhost:6379'],
    ])('rejects %s=%j', (name, value) => {
      expect(parse({ [name]: value }).error?.issues[0]?.path).toEqual([name]);
    });

    it('turns rate limiting off with RATE_LIMIT_ENABLED=false', () => {
      expect(parse({ RATE_LIMIT_ENABLED: 'false' }).data?.RATE_LIMIT_ENABLED).toBe(false);
    });
  });

  describe('geocoding', () => {
    const nominatim = { DATABASE_URL, ...JWT, GEO_PROVIDER: 'nominatim' };

    it('requires GEO_USER_AGENT with the nominatim provider', () => {
      for (const agent of [undefined, '', '   ']) {
        const result = appEnvSchema.safeParse({ ...nominatim, GEO_USER_AGENT: agent });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(['GEO_USER_AGENT']);
      }
    });

    it('rejects a User-Agent that carries an email address', () => {
      const result = appEnvSchema.safeParse({
        ...nominatim,
        GEO_USER_AGENT: 'Qaryati/1.0 (someone@example.com)',
      });
      expect(result.error?.issues[0]?.message).toBe('must not contain an email address');
    });

    it('accepts a project User-Agent', () => {
      const env = appEnvSchema.parse({
        ...nominatim,
        GEO_USER_AGENT: 'Qaryati/1.0 (university project)',
      });
      expect(env.GEO_USER_AGENT).toBe('Qaryati/1.0 (university project)');
    });

    it.each(['ftp://example.org', 'not a url'])('rejects GEO_NOMINATIM_URL=%j', (value) => {
      const result = appEnvSchema.safeParse({ DATABASE_URL, ...JWT, GEO_NOMINATIM_URL: value });
      expect(result.error?.issues[0]?.path).toEqual(['GEO_NOMINATIM_URL']);
    });

    it.each([
      ['GEO_BREAKER_THRESHOLD', '0'],
      ['GEO_RETRY_BASE_MS', '1.5'],
      ['GEO_MIN_INTERVAL_MS', '-1'],
      ['GEO_CACHE_TTL_SECONDS', '0'],
      ['GEO_CACHE_EMPTY_TTL_SECONDS', 'soon'],
    ])('rejects %s=%j', (name, value) => {
      const result = appEnvSchema.safeParse({ DATABASE_URL, ...JWT, [name]: value });
      expect(result.error?.issues[0]?.path).toEqual([name]);
    });

    it.each(['0', '99', '1.5', '60001'])('rejects GEO_TIMEOUT_MS=%j', (value) => {
      const result = appEnvSchema.safeParse({ DATABASE_URL, ...JWT, GEO_TIMEOUT_MS: value });
      expect(result.error?.issues[0]?.path).toEqual(['GEO_TIMEOUT_MS']);
    });
  });

  it.each(
    ['ADMIN_UNITS_CACHE_TTL_SECONDS', 'PRODUCTS_CACHE_TTL_SECONDS'].flatMap((name) =>
      ['0', '-5', '1.5', 'soon'].map((value) => [name, value] as const),
    ),
  )('rejects %s=%j', (name, value) => {
    const result = appEnvSchema.safeParse({ DATABASE_URL, ...JWT, [name]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([name]);
  });

  it.each([
    ['7d', 604800],
    ['12h', 43200],
    ['90s', 90],
  ])('parses JWT_REFRESH_TTL=%s into %i seconds', (value, seconds) => {
    const ttl = appEnvSchema.parse({
      DATABASE_URL,
      ...JWT,
      JWT_REFRESH_TTL: value,
    }).JWT_REFRESH_TTL;
    expect(parseRefreshTokenTtl(ttl)).toBe(seconds);
  });

  it.each(['', '0d', '-1d', '1.5d', '7', '7D', '7w', '9007199254740991d'])(
    'rejects invalid JWT_REFRESH_TTL=%j',
    (value) => {
      const result = appEnvSchema.safeParse({ DATABASE_URL, ...JWT, JWT_REFRESH_TTL: value });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['JWT_REFRESH_TTL']);
    },
  );

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
