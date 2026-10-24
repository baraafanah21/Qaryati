import { SetMetadata } from '@nestjs/common';

/** Shared HTTP metadata keeps platform routes independent of IAM. */
export const PUBLIC_ROUTE = Symbol('PUBLIC_ROUTE');

/** Skips authentication entirely; public requests have no authenticated actor. */
export function Public(): MethodDecorator & ClassDecorator {
  return SetMetadata(PUBLIC_ROUTE, true);
}
