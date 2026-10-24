import type { Role, AuthenticatedUser } from './authenticated-user';

const RANK: Record<Role, number> = { CONTRIBUTOR: 0, EDITOR: 1, ADMIN: 2 };

/** Framework-free role checks; resource-specific business policies stay with their owners. */
export class PermissionChecker {
  /** Higher roles inherit lower roles; anonymous callers never have a role. */
  hasRole(user: AuthenticatedUser | undefined, required: Role): boolean {
    return user !== undefined && RANK[user.role] >= RANK[required];
  }

  /** Any listed role suffices. An empty requirement allows any authenticated caller. */
  hasAnyRole(user: AuthenticatedUser | undefined, required: readonly Role[]): boolean {
    return (
      user !== undefined &&
      (required.length === 0 || required.some((role) => this.hasRole(user, role)))
    );
  }
}
