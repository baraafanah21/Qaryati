import * as argon2 from 'argon2';
import { PasswordHasher } from '../application/password-hasher';

const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
// Fixed valid PHC encoding with the same cost as real accounts. Its digest is not a credential.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Native hashing adapter; neither inputs nor hashes are logged. */
export class Argon2PasswordHasher extends PasswordHasher {
  async hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }
  async verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }
  async verifyDummy(password: string): Promise<void> {
    await argon2.verify(DUMMY_HASH, password);
  }
}
