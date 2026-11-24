import { z } from 'zod';
import { postgresUrl } from './postgres-url';
import { accessTokenTtl } from './access-token-ttl';
import { refreshTokenTtl } from './refresh-token-ttl';
import { corsOrigins, flag, perMinute, trustProxy } from './security-env';

/**
 * Environment variables the API process needs, validated once at startup.
 *
 * Every variable is listed in `.env.example` and documented in
 * docs/configuration.md. Add a variable here, there and in the example file in
 * the same change.
 */
/** Geocoding providers the geo module can wire behind its port. */
export const GEO_PROVIDERS = ['stub', 'nominatim'] as const;

export const appEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce
      .number({ error: 'must be a number' })
      .int('must be an integer')
      .min(1, 'must be between 1 and 65535')
      .max(65535, 'must be between 1 and 65535')
      .default(3000),
    /** Minimum pino level; `silent` turns logging off (the e2e tests use it). */
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Runtime role `qaryati_app` (DML only); never the owner role. */
    DATABASE_URL: postgresUrl,
    /** Paths only: key material is read once by IAM at startup. */
    JWT_PRIVATE_KEY_FILE: z.string({ error: 'is required' }).min(1, 'must not be empty'),
    JWT_PUBLIC_KEY_FILE: z.string({ error: 'is required' }).min(1, 'must not be empty'),
    JWT_ISSUER: z.string().min(1, 'must not be empty').default('qaryati'),
    /** Positive s/m/h duration; IAM converts this validated value into seconds at startup. */
    JWT_ACCESS_TTL: accessTokenTtl,
    /** Positive s/m/h/d refresh-token lifetime; a token expires this long after it is issued. */
    JWT_REFRESH_TTL: refreshTokenTtl,
    /** How long each API process caches administrative units (reference data), in seconds. */
    ADMIN_UNITS_CACHE_TTL_SECONDS: z.coerce
      .number({ error: 'must be a number' })
      .int('must be an integer')
      .min(1, 'must be at least 1')
      .default(3600),
    /** How long each API process caches products (reference data), in seconds. */
    PRODUCTS_CACHE_TTL_SECONDS: z.coerce
      .number({ error: 'must be a number' })
      .int('must be an integer')
      .min(1, 'must be at least 1')
      .default(3600),
    /**
     * Serves Swagger UI and the OpenAPI document. Unset means on, except with
     * `NODE_ENV=production` (src/platform/http/openapi.ts, isSwaggerEnabled).
     */
    SWAGGER_ENABLED: z.preprocess(
      // An empty value (`SWAGGER_ENABLED=` in .env) means "not set".
      (value) => (value === '' ? undefined : value),
      z.stringbool({ error: 'must be true or false' }).optional(),
    ),
    /** Geocoding adapter behind the geo port; `stub` needs no network (tests, CI, k6). */
    GEO_PROVIDER: z.enum(GEO_PROVIDERS).default('stub'),
    /** Base URL of the Nominatim API; a self-hosted instance can replace the public one. */
    GEO_NOMINATIM_URL: z
      .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
      .default('https://nominatim.openstreetmap.org'),
    /**
     * User-Agent sent to Nominatim, required by its usage policy. A project
     * identifier such as `Qaryati/1.0 (university project)`, never a personal email.
     */
    GEO_USER_AGENT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .trim()
        .min(1)
        .refine((value) => !value.includes('@'), 'must not contain an email address')
        .optional(),
    ),
    /** Time limit of one geocoding attempt, in milliseconds. */
    GEO_TIMEOUT_MS: z.coerce
      .number({ error: 'must be a number' })
      .int('must be an integer')
      .min(100, 'must be at least 100')
      .max(60_000, 'must be at most 60000')
      .default(5000),
    /** Redis for the shared rate-limit counters; down means throttling fails open. */
    REDIS_URL: z
      .url({ protocol: /^rediss?$/, error: 'must be a redis:// or rediss:// URL' })
      .default('redis://localhost:6379'),
    /** Turns rate limiting off entirely (the e2e suites, which share one Redis). */
    RATE_LIMIT_ENABLED: flag(true),
    /** Requests per minute per IP for callers without a token. */
    RATE_LIMIT_ANONYMOUS_PER_MINUTE: perMinute(120),
    /** Requests per minute per user for callers with a verified token. */
    RATE_LIMIT_USER_PER_MINUTE: perMinute(300),
    /** Login attempts per minute per IP and email. */
    RATE_LIMIT_LOGIN_PER_MINUTE: perMinute(5),
    CORS_ORIGINS: corsOrigins,
    TRUST_PROXY: trustProxy,
    /**
     * Port of the internal Prometheus endpoint (`GET /metrics`), served apart from
     * the public API so it is never routed to clients. 0 picks a free port (tests).
     */
    METRICS_PORT: z.coerce
      .number({ error: 'must be a number' })
      .int('must be an integer')
      .min(0, 'must be between 0 and 65535')
      .max(65535, 'must be between 0 and 65535')
      .default(9464),
  })
  .superRefine((env, ctx) => {
    if (env.GEO_PROVIDER === 'nominatim' && env.GEO_USER_AGENT === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['GEO_USER_AGENT'],
        message: 'is required when GEO_PROVIDER=nominatim',
      });
    }
  });

/** Validated API environment, as returned by `ConfigService<AppEnv, true>`. */
export type AppEnv = z.infer<typeof appEnvSchema>;
