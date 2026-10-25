import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../../shared/kernel';
import { Role } from '../domain/authenticated-user';
import { JoseAccessTokenVerifier } from './jose-access-token-verifier';
import { loadJwtKeys } from './jwt-keys';
import { TokenService } from './token.service';
import { createTestTokenIssuer } from './test-token-issuer';

describe('JWT secret files and public test issuer', () => {
  let directory: string;
  let privateKeyFile: string;
  let publicKeyFile: string;
  const clock = new FixedClock('2026-10-24T10:00:00Z');
  const pair = (modulusLength = 2048) =>
    generateKeyPairSync('rsa', {
      modulusLength,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
  const keys = pair();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'qaryati-key-unit-'));
    privateKeyFile = join(directory, 'private.pem');
    publicKeyFile = join(directory, 'public.pem');
    await writeFile(privateKeyFile, keys.privateKey, { mode: 0o600 });
    await writeFile(publicKeyFile, keys.publicKey, { mode: 0o600 });
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('loads files and mints tokens with one role using the supplied clock', async () => {
    const loaded = await loadJwtKeys(privateKeyFile, publicKeyFile);
    const verifier = new JoseAccessTokenVerifier(new TokenService(loaded, 'test', clock, 900));
    const issuer = await createTestTokenIssuer({
      privateKeyFile,
      publicKeyFile,
      issuer: 'test',
      clock,
    });
    const user = { id: '00000000-0000-7000-8000-000000000001', role: Role.EDITOR };
    await expect(verifier.verify(await issuer.mint(user))).resolves.toEqual(user);
    await expect(verifier.verify(await issuer.mint(user, -1))).rejects.toThrow();
  });

  it.each(['missing', 'malformed', 'mismatched', 'weak', 'non-rsa'])(
    'fails closed for %s keys without leaking secrets',
    async (kind) => {
      if (kind === 'missing') await rm(privateKeyFile);
      if (kind === 'malformed') await writeFile(privateKeyFile, 'secret-invalid-key');
      if (kind === 'mismatched') await writeFile(publicKeyFile, pair().publicKey);
      if (kind === 'weak') {
        const weak = pair(1024);
        await writeFile(privateKeyFile, weak.privateKey);
        await writeFile(publicKeyFile, weak.publicKey);
      }
      if (kind === 'non-rsa') {
        const ec = generateKeyPairSync('ec', {
          namedCurve: 'P-256',
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        });
        await writeFile(privateKeyFile, ec.privateKey);
        await writeFile(publicKeyFile, ec.publicKey);
      }
      await expect(loadJwtKeys(privateKeyFile, publicKeyFile)).rejects.toThrow(
        /^JWT key files must contain a matching PKCS#8\/SPKI RSA key pair of at least 2048 bits\.$/,
      );
    },
  );
});
