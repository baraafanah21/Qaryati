import { z } from 'zod';

const SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;
function seconds(value: string): number {
  return Number(value.slice(0, -1)) * SECONDS[value.slice(-1) as keyof typeof SECONDS];
}

/** Refresh-token lifetime: a positive integer followed by s, m, h or d; seven days by default. */
export const refreshTokenTtl = z
  .string()
  .regex(/^[1-9]\d*[smhd]$/, 'must be a positive integer followed by s, m, h or d (for example 7d)')
  .default('7d')
  .refine(
    (value) => Number.isSafeInteger(seconds(value) * 1000),
    'duration in milliseconds must be a safe integer',
  );

/** Converts the validated s/m/h/d duration into seconds. */
export function parseRefreshTokenTtl(value: string): number {
  return seconds(refreshTokenTtl.parse(value));
}
