import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

// Type only (erased): AppModule reads the environment when loaded, so it is required in beforeAll.
import type { AppModule as AppModuleType } from '../../src/app.module';
import {
  ListAuditEntries,
  type AuditLogPage,
} from '../../src/modules/audit/application/list-audit-entries.use-case';
import type { AuditLogFilter } from '../../src/modules/audit/domain/audit-log';
import { ValidationError } from '../../src/shared/kernel';
import { createTestJwtKeys, type TestJwtKeys } from '../support/jwt-test-keys';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../support/test-database';

const VILLAGE = '00000000-0000-7000-8000-000000004410';
const OTHER_VILLAGE = '00000000-0000-7000-8000-000000004411';
const ACTOR = '00000000-0000-7000-8000-000000004401';

describe('audit read APIs: keyset pagination on (occurred_at, id) (PostGIS)', () => {
  let database: TestDatabase;
  let keys: TestJwtKeys;
  let app: INestApplicationContext;
  let owner: Client;
  let entries: ListAuditEntries;

  /** Inserted as the owner: the runtime role may only INSERT through the recorder. */
  async function insertEntry(occurredAt: string, villageId: string | null, action = 'x.changed') {
    const id = randomUUID();
    await owner.query(
      `INSERT INTO audit_entry (id, action, entity_type, entity_id, village_id, actor_id,
         request_id, occurred_at, before, after)
       VALUES ($1, $2, 'Village', $3, $4, $5, 'req', $6, NULL, $7)`,
      [id, action, villageId ?? 'none', villageId, ACTOR, occurredAt, { slug: 'kept', secret: 1 }],
    );
    return { id, occurredAt: new Date(occurredAt).getTime() };
  }

  /** Every page from the first, following nextCursor. */
  async function allPages(filter: AuditLogFilter, limit: number): Promise<AuditLogPage[]> {
    const pages: AuditLogPage[] = [];
    let cursor: string | undefined;
    do {
      const page = await entries.execute({ filter, cursor, limit });
      pages.push(page);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined && pages.length < 100);
    return pages;
  }

  beforeAll(async () => {
    [database, keys] = await Promise.all([startTestDatabase(), createTestJwtKeys()]);
    process.env.DATABASE_URL = database.appUrl;
    process.env.JWT_PRIVATE_KEY_FILE = keys.privateKeyFile;
    process.env.JWT_PUBLIC_KEY_FILE = keys.publicKeyFile;
    process.env.LOG_LEVEL ??= 'silent';

    owner = new Client({ connectionString: database.ownerUrl });
    await owner.connect();

    const { AppModule } = jest.requireActual<{ AppModule: typeof AppModuleType }>(
      '../../src/app.module',
    );
    app = await (await Test.createTestingModule({ imports: [AppModule] }).compile()).init();
    entries = app.get(ListAuditEntries);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await Promise.all([database?.stop(), keys?.cleanup()]);
  });

  it('returns every row exactly once across pages, newest first, with equal timestamps', async () => {
    // 23 entries of the village on only three instants (10 + 10 + 3 ties),
    // so most page boundaries fall between entries with the same occurred_at.
    const expected: { id: string; occurredAt: number }[] = [];
    for (let i = 0; i < 10; i += 1)
      expected.push(await insertEntry('2026-11-20T10:00:00Z', VILLAGE));
    for (let i = 0; i < 10; i += 1)
      expected.push(await insertEntry('2026-11-20T11:00:00Z', VILLAGE));
    for (let i = 0; i < 3; i += 1)
      expected.push(await insertEntry('2026-11-20T09:00:00Z', VILLAGE));
    await insertEntry('2026-11-20T10:00:00Z', OTHER_VILLAGE);

    const pages = await allPages({ villageId: VILLAGE }, 4);
    const seen = pages.flatMap((page) => page.content);

    expect(pages).toHaveLength(6); // 4+4+4+4+4+3
    expect(pages.at(-1)?.nextCursor).toBeNull();
    expect(seen.map((e) => e.id).sort()).toEqual(expected.map((e) => e.id).sort());
    expect(new Set(seen.map((e) => e.id)).size).toBe(23);
    // Newest first; ties by id, descending.
    const order = [...expected].sort(
      (a, b) => b.occurredAt - a.occurredAt || (a.id < b.id ? 1 : -1),
    );
    expect(seen.map((e) => e.id)).toEqual(order.map((e) => e.id));
  });

  it('gives the same rows for every page size', async () => {
    const one = (await allPages({ villageId: VILLAGE }, 1)).flatMap((p) => p.content);
    const big = (await allPages({ villageId: VILLAGE }, 100)).flatMap((p) => p.content);
    expect(one.map((e) => e.id)).toEqual(big.map((e) => e.id));
  });

  it('filters by action and by a half-open time range [from, to)', async () => {
    await insertEntry('2026-11-21T08:00:00Z', VILLAGE, 'claim.verified');
    await insertEntry('2026-11-21T09:00:00Z', VILLAGE, 'claim.verified');
    const page = await entries.execute({
      filter: {
        action: 'claim.verified',
        from: new Date('2026-11-21T08:00:00Z'),
        to: new Date('2026-11-21T09:00:00Z'),
      },
      limit: 10,
    });
    expect(page.content.map((e) => e.occurredAt.toISOString())).toEqual([
      '2026-11-21T08:00:00.000Z',
    ]);
  });

  it('returns only the allow-listed snapshot fields', async () => {
    const page = await entries.execute({ filter: { villageId: VILLAGE }, limit: 1 });
    expect(page.content[0]?.after).toEqual({ slug: 'kept' });
  });

  it('rejects a cursor it did not issue and an empty time range (400)', async () => {
    await expect(
      entries.execute({ filter: {}, cursor: 'forged', limit: 5 }),
    ).rejects.toBeInstanceOf(ValidationError);
    const at = new Date('2026-11-21T08:00:00Z');
    await expect(
      entries.execute({ filter: { from: at, to: at }, limit: 5 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
