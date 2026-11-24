import { z } from 'zod';

/** An empty value (`NAME=` in .env) means "not set", so the default applies. */
const emptyAsUnset = (value: unknown) => (value === '' ? undefined : value);

/**
 * `CORS_ORIGINS`: comma-separated browser origins allowed to call the API, such as
 * `http://localhost:5173,https://qaryati.example`. Each entry must be a bare
 * `scheme://host[:port]` origin (no path, no trailing slash), because browsers send
 * exactly that in the `Origin` header. Empty means no browser origin is allowed.
 */
export const corsOrigins = z.preprocess(
  (value) => (value === undefined ? '' : value),
  z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ''),
    )
    .pipe(
      z.array(
        z
          .url({ protocol: /^https?$/, error: 'must list http(s) origins' })
          // zod runs this even when the URL check failed, so parse defensively.
          .refine((origin) => URL.canParse(origin) && new URL(origin).origin === origin, {
            message: 'must list bare origins such as https://example.org (no path or slash)',
          }),
      ),
    ),
);

/**
 * `TRUST_PROXY`: Express `trust proxy` setting, which decides what `req.ip` (and so
 * the rate-limit key of anonymous callers) is. `false` (default) uses the socket
 * address; a number trusts that many proxy hops; any other value is passed to Express
 * as a comma-separated list of trusted addresses or subnets (`loopback`, `10.0.0.0/8`).
 * `true` (trust every hop) is refused: any client could then pick its own IP.
 */
export const trustProxy = z.preprocess(
  emptyAsUnset,
  z
    .string()
    .default('false')
    .refine((value) => value.trim() !== 'true', {
      message: 'must not be true (any client could spoof its IP); give a hop count or addresses',
    })
    .transform((value): false | number | string => {
      const trimmed = value.trim();
      if (trimmed === 'false') return false;
      if (/^\d+$/.test(trimmed)) return Number(trimmed);
      return trimmed;
    }),
);

/** A positive whole number of requests per minute. */
export const perMinute = (fallback: number) =>
  z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .min(1, 'must be at least 1')
    .default(fallback);

/** `true`/`false` switch where an empty value means the default. */
export const flag = (fallback: boolean) =>
  z.preprocess(
    emptyAsUnset,
    z.stringbool({ error: 'must be true or false' }).optional().default(fallback),
  );
