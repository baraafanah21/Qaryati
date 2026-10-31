import {
  FixedClock,
  SequentialIdGenerator,
  UnauthenticatedError,
  type AuditEntry,
} from '../../../shared/kernel';
import { AccountStatus } from '../domain/account-status';
import { UserAccount } from '../domain/user-account';
import type { RefreshTokenRecord } from '../domain/refresh-token.repository';
import { LoginUser } from './login-user.use-case';
import { RegisterUser } from './register-user.use-case';

// Unit tests exercise application decisions only; real transactional wiring is covered over HTTP.
jest.mock('@nestjs-cls/transactional', () => ({ Transactional: () => () => undefined }));

describe('authentication use cases', () => {
  const clock = new FixedClock('2026-10-25T10:00:00Z');
  const ids = new SequentialIdGenerator();
  const account = UserAccount.create({
    id: ids.next<'UserAccount'>(),
    email: 'a@example.test',
    passwordHash: 'stored-hash',
    now: clock.now(),
  });
  function setup(found: UserAccount | undefined = account, correct = true) {
    const accounts = {
      findByEmail: jest.fn<Promise<UserAccount | undefined>, [string]>().mockResolvedValue(found),
      insert: jest.fn((value: UserAccount) => Promise.resolve(value)),
    };
    const passwords = {
      hash: jest.fn<Promise<string>, [string]>().mockResolvedValue('stored-hash'),
      verify: jest.fn<Promise<boolean>, [string, string]>().mockResolvedValue(correct),
      verifyDummy: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    };
    const refreshTokens = {
      insert: jest.fn<Promise<void>, [RefreshTokenRecord]>().mockResolvedValue(undefined),
    };
    const audit = { record: jest.fn<Promise<void>, [AuditEntry]>().mockResolvedValue(undefined) };
    const issuer = {
      issue: jest.fn(() => Promise.resolve({ accessToken: 'access-value', expiresIn: 900 })),
    };
    const generator = { generate: jest.fn(() => ({ raw: 'raw-refresh', hash: 'refresh-hash' })) };
    return {
      accounts,
      passwords,
      refreshTokens,
      audit,
      issuer,
      generator,
      login: new LoginUser(
        accounts,
        passwords,
        refreshTokens,
        generator,
        issuer,
        clock,
        ids,
        audit,
      ),
      register: new RegisterUser(accounts, passwords, clock, ids, audit),
    };
  }
  it('normalizes registration email, hashes verbatim input, and audits only safe fields', async () => {
    const test = setup();
    const result = await test.register.execute({
      email: ' A@Example.Test ',
      password: ' passphrase ',
    });
    expect(result.email).toBe('a@example.test');
    expect(test.passwords.hash).toHaveBeenCalledWith(' passphrase ');
    expect(test.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user_account.created',
        after: { email: 'a@example.test', role: 'CONTRIBUTOR', status: 'ACTIVE' },
      }),
    );
  });
  it.each(['wrong', 'disabled'])(
    'rejects %s uniformly without issuing or storing credentials',
    async (kind) => {
      const unavailable = UserAccount.restore({
        id: account.id,
        email: account.email,
        passwordHash: account.passwordHash,
        role: account.role,
        status: kind === 'disabled' ? AccountStatus.DISABLED : AccountStatus.ACTIVE,
        version: 1,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      });
      const test = setup(unavailable, kind !== 'wrong');
      await expect(
        test.login.execute({ email: ' A@Example.Test ', password: 'x' }),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'The email or password is incorrect.',
      });
      expect(test.passwords.verify).toHaveBeenCalledWith('stored-hash', 'x');
      expect(test.issuer.issue).not.toHaveBeenCalled();
      expect(test.refreshTokens.insert).not.toHaveBeenCalled();
      expect(test.audit.record).not.toHaveBeenCalled();
    },
  );
  it('unknown email invokes dummy Argon2 verification before INVALID_CREDENTIALS', async () => {
    const test = setup();
    test.accounts.findByEmail.mockResolvedValue(undefined);
    await expect(
      test.login.execute({ email: 'unknown@example.test', password: 'x' }),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'The email or password is incorrect.',
    });
    expect(test.passwords.verifyDummy).toHaveBeenCalledTimes(1);
    expect(test.passwords.verifyDummy).toHaveBeenCalledWith('x');
    expect(test.passwords.verify).not.toHaveBeenCalled();
    expect(test.refreshTokens.insert).not.toHaveBeenCalled();
    expect(test.audit.record).not.toHaveBeenCalled();
  });
  it('returns raw credentials only in the result and persists a seven-day digest record', async () => {
    const test = setup();
    const result = await test.login.execute({ email: account.email, password: 'correct-password' });
    expect(result).toEqual({
      accessToken: 'access-value',
      refreshToken: 'raw-refresh',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    const record = test.refreshTokens.insert.mock.calls[0]?.[0];
    expect(record?.tokenHash).toBe('refresh-hash');
    expect(record?.expiresAt.getTime()).toBe(clock.now().getTime() + 604800000);
    expect(record?.familyId).toBeDefined();
    expect(JSON.stringify(record)).not.toContain('raw-refresh');
    expect(JSON.stringify(test.audit.record.mock.calls)).not.toMatch(
      /raw-refresh|refresh-hash|stored-hash|correct-password/,
    );
    expect(test.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'refresh_token.issued' }),
    );
  });
  it('propagates persistence/audit failures rather than returning tokens', async () => {
    const test = setup();
    test.audit.record.mockRejectedValueOnce(new Error('audit failed'));
    await expect(
      test.login.execute({ email: account.email, password: 'correct-password' }),
    ).rejects.toThrow('audit failed');
    expect(new UnauthenticatedError('denied').code).toBe('UNAUTHENTICATED');
  });
});
