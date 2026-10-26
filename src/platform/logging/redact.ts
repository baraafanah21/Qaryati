/** What a redacted value is replaced with. */
export const REDACTED = '[REDACTED]';

// Key names whose values never reach a log, at any depth and in any case:
// password, newPassword, token, accessToken, refreshToken, secret, clientSecret,
// and the credential headers.
const SENSITIVE_KEY =
  /(password|secret|token)$|^password_?hash$|^(authorization|cookie|set-cookie)$/i;

const MAX_DEPTH = 10;

/** True when `key` names a value that must not be logged. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/**
 * Returns a copy of `value` with every sensitive key replaced by
 * {@link REDACTED}, at any depth. Plain objects and arrays are copied; other
 * objects (errors, dates, buffers) are kept as they are, since pino's own
 * serializers handle them. The input is never mutated.
 *
 * pino's built-in `redact` option needs fixed paths and cannot say "any depth",
 * so this runs as pino's `formatters.log` hook (see logger-options.ts).
 */
export function redactDeep<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]' as T;
  }
  if (Array.isArray(value)) {
    seen.add(value);
    const items = value.map((item: unknown) => redactDeep(item, depth + 1, seen));
    seen.delete(value);
    return items as T;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  seen.add(value);
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    copy[key] = isSensitiveKey(key) ? REDACTED : redactDeep(child, depth + 1, seen);
  }
  // `seen` holds only the current path, so an object referenced twice side by
  // side is copied twice instead of being reported as circular.
  seen.delete(value);
  return copy as T;
}
