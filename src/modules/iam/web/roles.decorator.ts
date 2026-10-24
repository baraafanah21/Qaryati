import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiProblems } from '../../../platform/http/openapi';
import type { Role } from '../domain/authenticated-user';

/** Metadata consumed after authentication; method declarations replace class declarations. */
export const REQUIRED_ROLES = Symbol('REQUIRED_ROLES');

/** Allows any listed role, including higher roles in the hierarchy. */
export function Roles(...roles: Role[]): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(REQUIRED_ROLES, roles), ApiProblems(403));
}
