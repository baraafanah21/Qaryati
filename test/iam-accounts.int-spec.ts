import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { DrizzleUserAccountRepository } from '../src/modules/iam/infrastructure/drizzle-user-account.repository';
import { DrizzleRefreshTokenRepository } from '../src/modules/iam/infrastructure/drizzle-refresh-token.repository';
import * as schema from '../src/modules/iam/infrastructure/persistence/schema';
import { Argon2PasswordHasher } from '../src/modules/iam/infrastructure/argon2-password-hasher';
import { CryptoRefreshTokenGenerator } from '../src/modules/iam/infrastructure/crypto-refresh-token-generator';
import { UserAccount } from '../src/modules/iam/domain/user-account';
import { asId, FixedClock, SequentialIdGenerator } from '../src/shared/kernel';
import {
  startTestDatabase,
  CONTAINER_STARTUP_TIMEOUT_MS,
  type TestDatabase,
} from './support/test-database';

describe('IAM persistence (real migrated PostGIS)', () => {
  let database: TestDatabase;
  let pool: Pool;
  let accounts: DrizzleUserAccountRepository;
  let tokens: DrizzleRefreshTokenRepository;
  const ids = new SequentialIdGenerator();
  const now = new FixedClock('2026-10-25T10:00:00Z').now();
  const hasher = new Argon2PasswordHasher();

  beforeAll(async () => {
    database = await startTestDatabase();
    pool = new Pool({ connectionString: database.appUrl });
    const db = drizzle({ client: pool, schema, casing: 'snake_case' });
    accounts = new DrizzleUserAccountRepository(db);
    tokens = new DrizzleRefreshTokenRepository(db);
  }, CONTAINER_STARTUP_TIMEOUT_MS);
  afterAll(async () => {
    await pool?.end();
    await database?.stop();
  });

  async function account() {
    return accounts.insert(
      UserAccount.create({
        id: ids.next<'UserAccount'>(),
        email: `${randomUUID()}@example.test`,
        passwordHash: await hasher.hash('correct-password'),
        now,
      }),
    );
  }
  it('restores accounts and uses citext for case-insensitive lookup and uniqueness', async () => {
    const first = await account();
    expect(await accounts.findByEmail(first.email.toUpperCase())).toMatchObject({
      id: first.id,
      role: 'CONTRIBUTOR',
      status: 'ACTIVE',
      version: 1,
      createdAt: now,
    });
    const duplicate = UserAccount.create({
      id: ids.next<'UserAccount'>(),
      email: first.email.toUpperCase(),
      passwordHash: first.passwordHash,
      now,
    });
    await expect(accounts.insert(duplicate)).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23505' }) as unknown,
    });
    expect(await accounts.findByEmail('unknown@example.test')).toBeUndefined();
    expect(await hasher.verify(first.passwordHash, 'correct-password')).toBe(true);
    expect(await hasher.verify(first.passwordHash, 'wrong-password')).toBe(false);
  });
  it('enforces role, status and version constraints in PostgreSQL', async () => {
    const first = await account();
    await expect(
      pool.query('UPDATE user_account SET role = $1 WHERE id = $2', ['ROOT', first.id]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'user_account_role_check' });
    await expect(
      pool.query('UPDATE user_account SET status = $1 WHERE id = $2', ['LOCKED', first.id]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'user_account_status_check' });
    await expect(
      pool.query('UPDATE user_account SET version = $1 WHERE id = $2', [0, first.id]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'user_account_version_check' });
  });
  it('enforces refresh FK, uniqueness, hash format and expiry, without storing a raw credential', async () => {
    const user = await account();
    const credential = new CryptoRefreshTokenGenerator().generate();
    const record = {
      id: ids.next<'RefreshToken'>(),
      userId: user.id,
      tokenHash: credential.hash,
      familyId: ids.next<'RefreshTokenFamily'>(),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 604800000),
    };
    await tokens.insert(record);
    const stored = await pool.query('SELECT * FROM refresh_token WHERE id = $1', [record.id]);
    expect(stored.rows[0]).toMatchObject({
      token_hash: credential.hash,
      user_id: user.id,
      family_id: record.familyId,
    });
    expect(JSON.stringify(stored.rows)).not.toContain(credential.raw);
    await expect(
      tokens.insert({ ...record, id: ids.next<'RefreshToken'>() }),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: '23505' }) as unknown });
    await expect(
      tokens.insert({
        ...record,
        id: ids.next<'RefreshToken'>(),
        tokenHash: 'a'.repeat(64),
        userId: asId<'UserAccount'>(randomUUID()),
      }),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: '23503' }) as unknown });
    await expect(
      tokens.insert({ ...record, id: ids.next<'RefreshToken'>(), tokenHash: 'raw-token' }),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: '23514' }) as unknown });
    await expect(
      tokens.insert({
        ...record,
        id: ids.next<'RefreshToken'>(),
        tokenHash: 'b'.repeat(64),
        expiresAt: now,
      }),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: '23514' }) as unknown });
  });
});
