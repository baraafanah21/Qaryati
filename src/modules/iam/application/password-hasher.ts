/** Password cryptography stays behind an adapter, including unknown-account verification. */
export abstract class PasswordHasher {
  abstract hash(password: string): Promise<string>;
  abstract verify(hash: string, password: string): Promise<boolean>;
  abstract verifyDummy(password: string): Promise<void>;
}
