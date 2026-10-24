/**
 * Public API of the iam module.
 *
 * Other modules may import only from this file, and only in the directions
 * listed in docs/architecture.md (enforced by dependency-cruiser). Export
 * facades, DTOs and event types here; never repositories, tables or entities.
 */
export { Role, type AuthenticatedUser } from './domain/authenticated-user';
export { PermissionChecker } from './domain/permission-checker';
export { Public } from '../../platform/http/public.decorator';
export { Roles } from './web/roles.decorator';
export { CurrentUser } from './web/current-user.decorator';
export {
  createTestTokenIssuer,
  type TestTokenIssuer,
  type TestTokenIssuerOptions,
} from './infrastructure/test-token-issuer';
