import './e2e-global-setup';

/** Stops the container started by e2e-global-setup.ts. */
export default async function globalTeardown(): Promise<void> {
  await globalThis.qaryatiE2eDatabase?.stop();
}
