/** Raw credentials exist only between generation and the response that returns them. */
export abstract class RefreshTokenGenerator {
  abstract generate(): { raw: string; hash: string };
  /** The stored digest of a presented raw token, computed the same way as `generate()`. */
  abstract hash(raw: string): string;
}
