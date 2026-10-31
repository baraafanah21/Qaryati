import { SequentialIdGenerator, ValidationError } from '../../../shared/kernel';
import { AccountStatus, isAccountStatus } from './account-status';
import { isRole, Role } from './authenticated-user';
import { normalizeEmail } from './email';
import { validatePassword } from './password-policy';
import { UserAccount } from './user-account';

describe('account rules', () => {
  it.each([9, 129])('rejects password length %i', (length) => {
    expect(() => validatePassword('x'.repeat(length))).toThrow(ValidationError);
  });
  it.each([10, 128])('accepts password length %i', (length) => {
    expect(() => validatePassword('x'.repeat(length))).not.toThrow();
  });
  it('counts UTF-16 units and does not trim or normalize passwords', () => {
    expect(() => validatePassword(' '.repeat(10))).not.toThrow();
    expect(() => validatePassword('😀'.repeat(5))).not.toThrow();
  });
  it('canonicalizes email without provider-specific alias rewriting', () => {
    expect(normalizeEmail(' User.Name+Tag@Example.COM ')).toBe('user.name+tag@example.com');
  });
  it.each([
    'bad',
    'x@@example.com',
    'a..b@example.com',
    '.a@example.com',
    'x@-bad.test',
    `${'a'.repeat(250)}@a.test`,
  ])('rejects invalid email %s', (email) => {
    expect(() => normalizeEmail(email)).toThrow(ValidationError);
  });
  it('accepts the email maximum boundary', () => {
    expect(normalizeEmail(`${'a'.repeat(247)}@a.test`)).toHaveLength(254);
  });
  it('forces registration defaults and keeps the audit snapshot safe', () => {
    const account = UserAccount.create({
      id: new SequentialIdGenerator().next<'UserAccount'>(),
      email: 'a@example.test',
      passwordHash: 'sensitive',
      now: new Date(0),
    });
    expect(account).toMatchObject({
      role: 'CONTRIBUTOR',
      status: 'ACTIVE',
      version: 1,
      canLogin: true,
    });
    expect(account.snapshot()).toEqual({
      email: 'a@example.test',
      role: 'CONTRIBUTOR',
      status: 'ACTIVE',
    });
    expect(JSON.stringify(account.snapshot())).not.toContain('sensitive');
  });
  it.each(['CONTRIBUTOR', 'EDITOR', 'ADMIN'])('accepts the role %s', (role) => {
    expect(isRole(role)).toBe(true);
  });
  it.each(['ROOT', 'admin', ''])('rejects the role %p', (role) => {
    expect(isRole(role)).toBe(false);
  });
  it.each(['ACTIVE', 'DISABLED'])('accepts the status %s', (status) => {
    expect(isAccountStatus(status)).toBe(true);
  });
  it.each(['LOCKED', 'DELETED', 'active', ''])('rejects the status %p', (status) => {
    expect(isAccountStatus(status)).toBe(false);
  });
  it('lets only an ACTIVE account log in', () => {
    const now = new Date(0);
    const restore = (status: AccountStatus) =>
      UserAccount.restore({
        id: new SequentialIdGenerator().next<'UserAccount'>(),
        email: 'a@example.test',
        passwordHash: 'hash',
        role: Role.CONTRIBUTOR,
        status,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    expect(restore(AccountStatus.ACTIVE).canLogin).toBe(true);
    expect(restore(AccountStatus.DISABLED).canLogin).toBe(false);
  });
});
