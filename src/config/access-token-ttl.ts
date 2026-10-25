import { z } from 'zod';

const SECONDS = { s: 1, m: 60, h: 3600 } as const;
function seconds(value: string): number {
  return Number(value.slice(0, -1)) * SECONDS[value.slice(-1) as keyof typeof SECONDS];
}

/** Keep the validated environment representation intact when Nest fills missing variables. */
export const accessTokenTtl = z
  .string()
  .regex(/^[1-9]\d*[smh]$/, 'must be a positive integer followed by s, m or h (for example 15m)')
  .default('15m')
  .refine(
    (value) => Number.isSafeInteger(seconds(value)),
    'duration in seconds must be a safe integer',
  );

/** Converts the validated s/m/h duration for JWT NumericDate arithmetic and expiresIn. */
export function parseAccessTokenTtl(value: string): number {
  return seconds(accessTokenTtl.parse(value));
}
