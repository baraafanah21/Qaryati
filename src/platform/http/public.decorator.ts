import { applyDecorators, SetMetadata } from '@nestjs/common';

/** Shared HTTP metadata keeps platform routes independent of IAM. */
export const PUBLIC_ROUTE = Symbol('PUBLIC_ROUTE');

/** Set by `@Public({ optionalUser: true })`: the route is public but reads a bearer token if sent. */
export const OPTIONAL_USER = Symbol('OPTIONAL_USER');

/** Options of {@link Public}. */
export interface PublicOptions {
  /**
   * Verify a bearer token when the request sends one, so the handler sees the
   * caller (for example to show drafts to logged-in users). Without a token
   * the request stays anonymous; an invalid token is still a 401, so a client
   * with an expired token learns to refresh it instead of silently seeing less.
   */
  optionalUser?: boolean;
}

/**
 * Skips required authentication. By default public requests have no
 * authenticated actor, even when they send a token.
 */
export function Public(options: PublicOptions = {}): MethodDecorator & ClassDecorator {
  return options.optionalUser
    ? applyDecorators(SetMetadata(PUBLIC_ROUTE, true), SetMetadata(OPTIONAL_USER, true))
    : SetMetadata(PUBLIC_ROUTE, true);
}
