import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Temporary secrets are generated per run, never checked in or printed. */
export interface TestJwtKeys {
  directory: string;
  privateKeyFile: string;
  publicKeyFile: string;
  cleanup(): Promise<void>;
}

/** Creates PKCS#8/SPKI RSA files for the same startup path used in production. */
export async function createTestJwtKeys(): Promise<TestJwtKeys> {
  const directory = await mkdtemp(join(tmpdir(), 'qaryati-jwt-'));
  const privateKeyFile = join(directory, 'private.pem');
  const publicKeyFile = join(directory, 'public.pem');
  try {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    await Promise.all([
      writeFile(privateKeyFile, pair.privateKey, { mode: 0o600 }),
      writeFile(publicKeyFile, pair.publicKey, { mode: 0o600 }),
    ]);
    return {
      directory,
      privateKeyFile,
      publicKeyFile,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
