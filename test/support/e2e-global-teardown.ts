import './e2e-global-setup';

/** Stops the container started by e2e-global-setup.ts. */
export default async function globalTeardown(): Promise<void> {
  try {
    await globalThis.qaryatiE2eDatabase?.stop();
  } finally {
    await globalThis.qaryatiE2eKeys?.cleanup();
  }
}
