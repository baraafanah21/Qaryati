import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';

// Type only (erased): AppModule reads the environment when loaded, so it is required in beforeAll.
import type { AppModule as AppModuleType } from '../../src/app.module';
import { GetVillageProfile } from '../../src/modules/profile/application/get-village-profile.use-case';
import { AUDIT_RECORDER } from '../../src/shared/kernel';
import { SEED_CLAIM_TYPES, seedClaim, type SeedClaimType } from '../support/claim-seed';
import { InMemoryAuditRecorder } from '../support/in-memory-audit-recorder';
import { createTestJwtKeys, type TestJwtKeys } from '../support/jwt-test-keys';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../support/test-database';

const AUTHOR = '00000000-0000-7000-8000-000000003901';
const SOURCE = '00000000-0000-7000-8000-000000003902';
const VILLAGES = {
  few: '00000000-0000-7000-8000-000000003910',
  many: '00000000-0000-7000-8000-000000003911',
  neighbour: '00000000-0000-7000-8000-000000003912',
} as const;

/** Statements the profile may run, whatever the number of facts (see GetVillageProfile). */
const MAX_STATEMENTS = 17;

describe('profile: a fixed number of queries per profile (PostGIS)', () => {
  let database: TestDatabase;
  let keys: TestJwtKeys;
  let app: INestApplicationContext;
  let owner: Client;
  let profiles: GetVillageProfile;

  const seed = (type: SeedClaimType, villageId: string, text?: string) =>
    seedClaim(owner, { type, villageId, sourceId: SOURCE, authorId: AUTHOR, text });

  /**
   * The SQL statements one profile read sends, counted on `pg.Client#query`:
   * every pooled query, the app's included, goes through it exactly once.
   * The owner client is idle meanwhile.
   */
  async function statementsFor(villageId: string): Promise<number> {
    const spy = jest.spyOn(Client.prototype, 'query');
    try {
      await profiles.execute(villageId, undefined);
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  }

  beforeAll(async () => {
    [database, keys] = await Promise.all([startTestDatabase(), createTestJwtKeys()]);
    process.env.DATABASE_URL = database.appUrl;
    process.env.JWT_PRIVATE_KEY_FILE = keys.privateKeyFile;
    process.env.JWT_PUBLIC_KEY_FILE = keys.publicKeyFile;
    process.env.LOG_LEVEL ??= 'silent';

    owner = new Client({ connectionString: database.ownerUrl });
    await owner.connect();
    await owner.query(
      `INSERT INTO user_account (id, email, password_hash, role, status, version, created_at, updated_at)
       VALUES ($1, 'profile-int@test.local', 'hash', 'EDITOR', 'ACTIVE', 1, now(), now())`,
      [AUTHOR],
    );
    for (const [slug, id] of Object.entries(VILLAGES)) {
      await owner.query(
        `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
           created_by, version, created_at, updated_at)
         VALUES ($1, $2, 'INHABITED', 'PUBLISHED', 'قرية', $3, 1, now(), now())`,
        [id, `profile-${slug}`, AUTHOR],
      );
    }
    await owner.query(
      `INSERT INTO source (id, source_type, title, reliability, created_by, version, created_at, updated_at)
       VALUES ($1, 'BOOK', 'Profile source', 4, $2, 1, now(), now())`,
      [SOURCE, AUTHOR],
    );

    // Both villages have one published fact of every type; `many` has 20
    // landmarks, events, cultural items, facilities and population records.
    for (const villageId of [VILLAGES.few, VILLAGES.many]) {
      for (const type of SEED_CLAIM_TYPES) {
        await seed(type, villageId, type === 'RELATION' ? VILLAGES.neighbour : undefined);
      }
    }
    for (let i = 1; i < 20; i += 1) {
      await seed('LANDMARK', VILLAGES.many, `Landmark ${i}`);
      await seed('HISTORICAL_EVENT', VILLAGES.many, `Event ${i}`);
      await seed('CULTURAL_ITEM', VILLAGES.many, `Dish ${i}`);
      await seed('FACILITY', VILLAGES.many, `School ${i}`);
      await seed('POPULATION', VILLAGES.many, String(1900 + i));
    }

    const { AppModule } = jest.requireActual<{ AppModule: typeof AppModuleType }>(
      '../../src/app.module',
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUDIT_RECORDER)
      .useValue(new InMemoryAuditRecorder())
      .compile();
    app = await moduleRef.init();
    profiles = app.get(GetVillageProfile);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await Promise.all([database?.stop(), keys?.cleanup()]);
  });

  it('reads every section of both villages', async () => {
    const [few, many] = await Promise.all([
      profiles.execute(VILLAGES.few, undefined),
      profiles.execute(VILLAGES.many, undefined),
    ]);
    expect(few.heritage.landmarks).toHaveLength(1);
    expect(many.heritage.landmarks).toHaveLength(20);
    expect(many.population.history).toHaveLength(20);
    expect(many.relations).toHaveLength(1);
    expect(many.affiliations).toHaveLength(1);
  });

  it('sends the same number of statements for 1 and for 20 facts of a type (no N+1)', async () => {
    // Warm the in-process caches (administrative units, products) first, so
    // both reads below hit the same caches.
    await profiles.execute(VILLAGES.few, undefined);

    const few = await statementsFor(VILLAGES.few);
    const many = await statementsFor(VILLAGES.many);

    expect(many).toBe(few);
    expect(few).toBeGreaterThan(0);
    expect(few).toBeLessThanOrEqual(MAX_STATEMENTS);
  });
});
