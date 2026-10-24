import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** Parsed runtime keys; never serialized or included in diagnostics. */
export interface JwtKeys {
  privateKey: ReturnType<typeof createPrivateKey>;
  publicKey: ReturnType<typeof createPublicKey>;
}

/** Loads a matching RSA pair once at startup, failing closed without exposing key contents. */
export async function loadJwtKeys(privatePath: string, publicPath: string): Promise<JwtKeys> {
  try {
    const [privatePem, publicPem] = await Promise.all([
      readFile(privatePath, 'utf8'),
      readFile(publicPath, 'utf8'),
    ]);
    if (
      !privatePem.startsWith('-----BEGIN PRIVATE KEY-----') ||
      !publicPem.startsWith('-----BEGIN PUBLIC KEY-----')
    )
      throw new Error('Invalid PEM format');
    const privateKey = createPrivateKey(privatePem);
    const publicKey = createPublicKey(publicPem);
    if (
      privateKey.asymmetricKeyType !== 'rsa' ||
      publicKey.asymmetricKeyType !== 'rsa' ||
      (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
      (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
      !createPublicKey(privateKey)
        .export({ type: 'spki', format: 'der' })
        .equals(publicKey.export({ type: 'spki', format: 'der' }))
    )
      throw new Error('Invalid RSA pair');
    return { privateKey, publicKey };
  } catch {
    throw new Error(
      'JWT key files must contain a matching PKCS#8/SPKI RSA key pair of at least 2048 bits.',
    );
  }
}
