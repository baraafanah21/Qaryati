import { BusinessRuleViolationError, SequentialIdGenerator } from '../../../shared/kernel';
import { assertNotSelf } from './account-administration';
import { AccountStatus } from './account-status';
import { Role } from './authenticated-user';
import { UserAccount } from './user-account';

describe('account administration', () => {
  it('refuses a change of the caller’s own account with SELF_ADMINISTRATION_FORBIDDEN', () => {
    expect(() => assertNotSelf('a', 'a')).toThrow(BusinessRuleViolationError);
    expect(() => assertNotSelf('a', 'a')).toThrow(
      expect.objectContaining({ code: 'SELF_ADMINISTRATION_FORBIDDEN' }) as Error,
    );
    expect(() => assertNotSelf('a', 'b')).not.toThrow();
  });

  it('changes role or status without touching anything else', () => {
    const account = UserAccount.create({
      id: new SequentialIdGenerator().next<'UserAccount'>(),
      email: 'a@example.test',
      passwordHash: 'hash',
      now: new Date(0),
    });
    const editor = account.withRole(Role.EDITOR);
    expect(editor.role).toBe(Role.EDITOR);
    expect(editor.status).toBe(AccountStatus.ACTIVE);
    expect(editor.version).toBe(account.version);
    const disabled = account.withStatus(AccountStatus.DISABLED);
    expect(disabled.status).toBe(AccountStatus.DISABLED);
    expect(disabled.canLogin).toBe(false);
    expect(account.role).toBe(Role.CONTRIBUTOR);
  });
});
