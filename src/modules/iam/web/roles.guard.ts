import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_ROUTE } from '../../../platform/http/public.decorator';
import type { Role } from '../domain/authenticated-user';
import { PermissionChecker } from '../domain/permission-checker';
import type { AuthenticatedRequest } from './current-user.decorator';
import { REQUIRED_ROLES } from './roles.decorator';

/** Applies role policy after JwtAuthGuard; only the HTTP layer throws HTTP exceptions. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionChecker,
  ) {}

  /** Rejects conflicting public/role declarations rather than silently opening access. */
  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, targets);
    if (required === undefined) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets) ||
      !this.permissions.hasAnyRole(
        context.switchToHttp().getRequest<AuthenticatedRequest>().user,
        required,
      )
    ) {
      throw new ForbiddenException('Your role does not allow this action.');
    }
    return true;
  }
}
