/** Raw credentials exist only between generation and the login response. */
export abstract class RefreshTokenGenerator {
  abstract generate(): { raw: string; hash: string };
}
