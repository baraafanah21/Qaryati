import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../domain/authenticated-user';

/** HTTP request identity is assigned only by JwtAuthGuard after verification. */
export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

/** Returns the verified identity, or undefined on an anonymous public route. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
