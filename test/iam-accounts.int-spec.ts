import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { DrizzleUserAccountRepository } from '../src/modules/iam/infrastructure/drizzle-user-account.repository';
import { DrizzleRefreshTokenRepository } from '../src/modules/iam/infrastructure/drizzle-refresh-token.repository';
import * as schema from '../src/modules/iam/infrastructure/persistence/schema';
import { Argon2PasswordHasher } from '../src/modules/iam/infrastructure/argon2-password-hasher';
import { CryptoRefreshTokenGenerator } from '../src/modules/iam/infrastructure/crypto-refresh-token-generator';
import { UserAccount } from '../src/modules/iam/domain/user-account';
import { asId, FixedClock, SequentialIdGenerator, type Id } from '../src/shared/kernel';
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
  it('stores role and status as plain text and refuses to restore an unknown value', async () => {
    const first = await account();
    // No CHECK: the database accepts any text; the repository is the guard on read.
    await pool.query('UPDATE user_account SET role = $1 WHERE id = $2', ['ROOT', first.id]);
    await expect(accounts.findByEmail(first.email)).rejects.toThrow(/unknown role/);
    await pool.query('UPDATE user_account SET role = $1, status = $2 WHERE id = $3', [
      'CONTRIBUTOR',
      'LOCKED',
      first.id,
    ]);
    await expect(accounts.findByEmail(first.email)).rejects.toThrow(/unknown status/);
    const constraints = await pool.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid IN ('user_account'::regclass, 'refresh_token'::regclass) AND contype = 'c'`,
    );
    expect(constraints.rows).toEqual([]);
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'user_account' ORDER BY column_name`,
    );
    expect(columns.rows.map((row: { column_name: string }) => row.column_name)).toEqual([
      'created_at',
      'email',
      'id',
      'password_hash',
      'role',
      'status',
      'updated_at',
      'version',
    ]);
  });
  it('enforces refresh FK and uniqueness, and the domain hash and expiry rules, without storing a raw credential', async () => {
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
    ).rejects.toThrow(/64 lowercase hex/);
    await expect(
      tokens.insert({
        ...record,
        id: ids.next<'RefreshToken'>(),
        tokenHash: 'b'.repeat(64),
        expiresAt: now,
      }),
    ).rejects.toThrow(/expire after/);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM refresh_token');
    expect(rows).toEqual([{ n: 1 }]);
  });

  describe('refresh-token lifecycle (#18)', () => {
    const generator = new CryptoRefreshTokenGenerator();
    function issue(userId: Id<'UserAccount'>, familyId: Id<'RefreshTokenFamily'>) {
      const record = {
        id: ids.next<'RefreshToken'>(),
        userId,
        tokenHash: generator.generate().hash,
        familyId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 604800000),
      };
      return tokens.insert(record).then(() => record);
    }

    it('finds a token by digest as an unrevoked, unreplaced row, and an account by id', async () => {
      const user = await account();
      const record = await issue(user.id, ids.next<'RefreshTokenFamily'>());
      expect(await tokens.findByHashForUpdate(record.tokenHash)).toEqual({
        ...record,
        revokedAt: null,
        replacedById: null,
      });
      expect(await tokens.findByHashForUpdate('c'.repeat(64))).toBeUndefined();
      expect(await accounts.findById(user.id)).toMatchObject({ id: user.id, email: user.email });
      expect(await accounts.findById(asId<'UserAccount'>(randomUUID()))).toBeUndefined();
    });

    it('rotation sets revoked_at and replaced_by_id and keeps the family', async () => {
      const user = await account();
      const family = ids.next<'RefreshTokenFamily'>();
      const old = await issue(user.id, family);
      const next = await issue(user.id, family);
      const revokedAt = new Date(now.getTime() + 60_000);
      await tokens.markRotated(old.id, revokedAt, next.id);
      expect(await tokens.findByHashForUpdate(old.tokenHash)).toMatchObject({
        familyId: family,
        revokedAt,
        replacedById: next.id,
      });
      expect(await tokens.findByHashForUpdate(next.tokenHash)).toMatchObject({
        familyId: family,
        revokedAt: null,
        replacedById: null,
      });
    });

    it('revokes only the active tokens of one family and reports how many it revoked', async () => {
      const user = await account();
      const family = ids.next<'RefreshTokenFamily'>();
      const other = ids.next<'RefreshTokenFamily'>();
      const first = await issue(user.id, family);
      const second = await issue(user.id, family);
      const elsewhere = await issue(user.id, other);
      const earlier = new Date(now.getTime() + 1000);
      await tokens.markRotated(first.id, earlier, second.id);
      const revokedAt = new Date(now.getTime() + 2000);

      expect(await tokens.revokeFamily(family, revokedAt)).toBe(1);
      expect((await tokens.findByHashForUpdate(first.tokenHash))?.revokedAt).toEqual(earlier);
      expect((await tokens.findByHashForUpdate(second.tokenHash))?.revokedAt).toEqual(revokedAt);
      expect((await tokens.findByHashForUpdate(elsewhere.tokenHash))?.revokedAt).toBeNull();
      expect(await tokens.revokeFamily(family, new Date(now.getTime() + 3000))).toBe(0);
    });

    it('rejects a replaced_by_id that does not exist (SQLSTATE 23503)', async () => {
      const user = await account();
      const record = await issue(user.id, ids.next<'RefreshTokenFamily'>());
      await expect(
        tokens.markRotated(record.id, now, asId<'RefreshToken'>(randomUUID())),
      ).rejects.toMatchObject({ cause: expect.objectContaining({ code: '23503' }) as unknown });
    });

    it('indexes family_id and replaced_by_id', async () => {
      const { rows } = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'refresh_token' ORDER BY indexname`,
      );
      expect(rows.map((row) => row.indexname)).toEqual(
        expect.arrayContaining(['refresh_token_family_id_idx', 'refresh_token_replaced_by_id_idx']),
      );
    });
  });
});
