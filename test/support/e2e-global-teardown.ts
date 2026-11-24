import './e2e-global-setup';

/** Stops the containers started by e2e-global-setup.ts. */
export default async function globalTeardown(): Promise<void> {
  try {
    await Promise.all([globalThis.qaryatiE2eDatabase?.stop(), globalThis.qaryatiE2eRedis?.stop()]);
  } finally {
    await globalThis.qaryatiE2eKeys?.cleanup();
  }
}
