// Generates the local RS256 key pair the API reads at startup (see docs/development.md).
// Usage: npm run keys:dev            (refuses to overwrite an existing pair)
//        npm run keys:dev -- --force (replaces it; tokens signed with the old key stop working)
//
// Plain Node (node:crypto), so it works the same on Linux, macOS and Windows without OpenSSL.
// The paths match JWT_PRIVATE_KEY_FILE and JWT_PUBLIC_KEY_FILE in .env.example. secrets/ is
// git-ignored: these files must never be committed.
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const privateKeyFile = join(root, 'secrets', 'jwt-private.pem');
const publicKeyFile = join(root, 'secrets', 'jwt-public.pem');
const force = process.argv.includes('--force');

if (!force && (existsSync(privateKeyFile) || existsSync(publicKeyFile))) {
  console.error(
    'secrets/jwt-*.pem already exist. Keep them, or run `npm run keys:dev -- --force`.',
  );
  process.exit(1);
}

// PKCS#8 private and SPKI public PEM, 2048 bits: what src/modules/iam/infrastructure/jwt-keys.ts accepts.
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

mkdirSync(join(root, 'secrets'), { recursive: true });
writeFileSync(privateKeyFile, privateKey, { mode: 0o600 });
writeFileSync(publicKeyFile, publicKey, { mode: 0o644 });
// `mode` applies only to new files; --force on an existing pair must still end at 600/644.
chmodSync(privateKeyFile, 0o600);
chmodSync(publicKeyFile, 0o644);
console.log('Wrote secrets/jwt-private.pem (mode 600) and secrets/jwt-public.pem.');

// The API container runs as `node` (uid 1000) and must be able to read the private key.
if (process.platform === 'linux' && process.getuid?.() !== 1000) {
  console.log('Linux: for Docker Compose, run `sudo chown 1000 secrets/jwt-private.pem` once.');
}
