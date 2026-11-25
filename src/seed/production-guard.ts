/**
 * Seeds write sample data, known passwords and bootstrap roles: never in production.
 * Throws for `NODE_ENV=production`, so both seed entry points stop before connecting.
 */
export function assertNotProduction(nodeEnv: string, tool: string): void {
  if (nodeEnv === 'production') {
    throw new Error(`${tool} refuses to run with NODE_ENV=production: it is for development only.`);
  }
}
