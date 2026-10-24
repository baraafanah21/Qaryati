import { Role } from './authenticated-user';
import { PermissionChecker } from './permission-checker';

describe('PermissionChecker', () => {
  const checker = new PermissionChecker();
  const roles = [Role.CONTRIBUTOR, Role.EDITOR, Role.ADMIN];

  it.each(
    roles.flatMap((role, rank) =>
      roles.map((required, requiredRank) => ({ role, required, allowed: rank >= requiredRank })),
    ),
  )('$role requesting $required: $allowed', ({ role, required, allowed }) => {
    expect(checker.hasRole({ id: 'user', role }, required)).toBe(allowed);
  });

  it('uses OR semantics and requires an identity even for an empty requirement', () => {
    const user = { id: 'user', role: Role.EDITOR };
    expect(checker.hasAnyRole(user, [Role.ADMIN, Role.CONTRIBUTOR])).toBe(true);
    expect(checker.hasAnyRole(user, [Role.ADMIN])).toBe(false);
    expect(checker.hasAnyRole(user, [])).toBe(true);
    expect(checker.hasAnyRole(undefined, [])).toBe(false);
    expect(checker.hasRole(undefined, Role.CONTRIBUTOR)).toBe(false);
  });
});
