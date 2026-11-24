import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';

// Type only (erased): AppModule reads the environment when loaded, so it is required in beforeAll.
import type { AppModule as AppModuleType } from '../../src/app.module';
import { Client, DatabaseError } from 'pg';

import {
  ReviewClaim,
  type ReviewClaimInput,
} from '../../src/modules/curation/application/review-claim.use-case';
import { FindNearbyVillages } from '../../src/modules/village/application/find-nearby-villages.use-case';
import { VILLAGE_LOCATION_CHANGED } from '../../src/modules/village';
import {
  asId,
  AUDIT_RECORDER,
  DOMAIN_EVENT_PUBLISHER,
  type DomainEvent,
  type DomainEventPublisher,
} from '../../src/shared/kernel';
import { InMemoryAuditRecorder } from '../support/in-memory-audit-recorder';
import { createTestJwtKeys, type TestJwtKeys } from '../support/jwt-test-keys';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../support/test-database';

const AUTHOR = '00000000-0000-7000-8000-000000000f01';
const EDITOR = '00000000-0000-7000-8000-000000000f02';
const SOURCE = '00000000-0000-7000-8000-000000000f20';

/** Published villages around ORIGIN (Nablus area), one draft, one far away. */
const VILLAGES = {
  origin: { id: '00000000-0000-7000-8000-000000000f10', status: 'PUBLISHED', at: [32.22, 35.26] },
  near: { id: '00000000-0000-7000-8000-000000000f11', status: 'PUBLISHED', at: [32.23, 35.26] },
  middle: { id: '00000000-0000-7000-8000-000000000f12', status: 'PUBLISHED', at: [32.26, 35.26] },
  draft: { id: '00000000-0000-7000-8000-000000000f13', status: 'DRAFT', at: [32.221, 35.26] },
  far: { id: '00000000-0000-7000-8000-000000000f14', status: 'PUBLISHED', at: [31.5, 34.5] },
  noLocation: { id: '00000000-0000-7000-8000-000000000f15', status: 'PUBLISHED', at: null },
} as const;

/** A row of each fact table, for a claim id, with its fixed columns filled. */
const FACT_INSERTS: Record<string, { claimType: string; sql: string }> = {
  village_name: {
    claimType: 'VILLAGE_NAME',
    sql: `INSERT INTO village_name (claim_id, name, name_normalized, lang, name_type)
          VALUES ($1, 'قرية', 'قريه', 'ar', 'CURRENT')`,
  },
  name_origin: {
    claimType: 'NAME_ORIGIN',
    sql: `INSERT INTO name_origin (claim_id, meaning) VALUES ($1, 'the well')`,
  },
  village_affiliation: {
    claimType: 'AFFILIATION',
    sql: `INSERT INTO village_affiliation (claim_id, admin_unit_id)
          VALUES ($1, (SELECT id FROM admin_unit ORDER BY code LIMIT 1))`,
  },
  village_location: {
    claimType: 'LOCATION',
    sql: `INSERT INTO village_location (claim_id, point, precision)
          VALUES ($1, ST_SetSRID(ST_MakePoint(35.2, 32.2), 4326)::geography, 'EXACT')`,
  },
  village_measure: {
    claimType: 'MEASURE',
    sql: `INSERT INTO village_measure (claim_id, kind, value) VALUES ($1, 'ELEVATION_M', 550)`,
  },
  village_relation: {
    claimType: 'RELATION',
    sql: `INSERT INTO village_relation (claim_id, related_village_id, relation_type)
          VALUES ($1, '${VILLAGES.near.id}', 'ADJACENT')`,
  },
};

describe('village facts: tables, projections and nearby (PostGIS)', () => {
  let database: TestDatabase;
  let keys: TestJwtKeys;
  let app: INestApplicationContext;
  let owner: Client;
  let cls: ClsService;
  let review: ReviewClaim;
  let nearby: FindNearbyVillages;
  let publisher: DomainEventPublisher;
  const audit = new InMemoryAuditRecorder();
  let counter = 0;

  const run = (input: Omit<ReviewClaimInput, 'reviewerId' | 'id'> & { id: string }) =>
    cls.run(() => review.execute({ reviewerId: EDITOR, ...input, id: asId<'Claim'>(input.id) }));

  async function insertClaim(
    claimType: string,
    options: { groupKey?: string; villageId?: string } = {},
  ): Promise<string> {
    counter += 1;
    const result = await owner.query<{ id: string }>(
      `INSERT INTO claim (id, claim_type, village_id, group_key, value_hash, source_id, status,
         is_preferred, created_by, version, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'UNVERIFIED', false, $6, 1, now(), now())
       RETURNING id`,
      [
        claimType,
        options.villageId ?? VILLAGES.origin.id,
        options.groupKey ?? `int|${counter}`,
        `hash-${counter}`,
        SOURCE,
        AUTHOR,
      ],
    );
    return result.rows[0]!.id;
  }

  async function villageRow(id: string) {
    const result = await owner.query<{
      display_name_ar: string;
      display_name_en: string | null;
      latitude: number | null;
      longitude: number | null;
      version: number;
    }>(
      `SELECT display_name_ar, display_name_en, version,
              ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
       FROM village WHERE id = $1`,
      [id],
    );
    return result.rows[0]!;
  }

  async function claimState(id: string) {
    const result = await owner.query<{ status: string; is_preferred: boolean; version: number }>(
      'SELECT status, is_preferred, version FROM claim WHERE id = $1',
      [id],
    );
    return result.rows[0]!;
  }

  beforeAll(async () => {
    [database, keys] = await Promise.all([startTestDatabase(), createTestJwtKeys()]);
    process.env.DATABASE_URL = database.appUrl;
    process.env.JWT_PRIVATE_KEY_FILE = keys.privateKeyFile;
    process.env.JWT_PUBLIC_KEY_FILE = keys.publicKeyFile;
    process.env.LOG_LEVEL ??= 'silent';

    owner = new Client({ connectionString: database.ownerUrl });
    await owner.connect();
    for (const [id, role] of [
      [AUTHOR, 'CONTRIBUTOR'],
      [EDITOR, 'EDITOR'],
    ] as const) {
      await owner.query(
        `INSERT INTO user_account (id, email, password_hash, role, status, version, created_at, updated_at)
         VALUES ($1, $2, 'hash', $3, 'ACTIVE', 1, now(), now())`,
        [id, `${id}@test.local`, role],
      );
    }
    for (const [slug, village] of Object.entries(VILLAGES)) {
      await owner.query(
        `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
           location, created_by, version, created_at, updated_at)
         VALUES ($1, $2, 'INHABITED', $3, $4,
           CASE WHEN $5::float8 IS NULL THEN NULL
                ELSE ST_SetSRID(ST_MakePoint($6::float8, $5::float8), 4326)::geography END,
           $7, 1, now(), now())`,
        [
          village.id,
          `facts-${slug.toLowerCase()}`,
          village.status,
          `قرية ${slug}`,
          village.at?.[0] ?? null,
          village.at?.[1] ?? null,
          AUTHOR,
        ],
      );
    }
    await owner.query(
      `INSERT INTO source (id, source_type, title, reliability, created_by, version, created_at, updated_at)
       VALUES ($1, 'BOOK', 'Village facts source', 4, $2, 1, now(), now())`,
      [SOURCE, AUTHOR],
    );

    // AppModule reads the environment when it is imported, so import it now.
    const { AppModule } = jest.requireActual<{ AppModule: typeof AppModuleType }>(
      '../../src/app.module',
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUDIT_RECORDER)
      .useValue(audit)
      .compile();
    app = await moduleRef.init();
    cls = app.get(ClsService);
    review = app.get(ReviewClaim);
    nearby = app.get(FindNearbyVillages);
    publisher = app.get(DOMAIN_EVENT_PUBLISHER);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await Promise.all([database?.stop(), keys?.cleanup()]);
  });

  beforeEach(() => {
    audit.clear();
    jest.restoreAllMocks();
  });

  describe('fact tables', () => {
    it.each(Object.entries(FACT_INSERTS))(
      '%s rejects a claim of another type (composite foreign key)',
      async (_table, { claimType, sql }) => {
        const wrongType = claimType === 'MEASURE' ? 'LOCATION' : 'MEASURE';
        const claimId = await insertClaim(wrongType);
        const error = await owner.query(sql, [claimId]).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe('23503');
      },
    );

    it.each(Object.entries(FACT_INSERTS))(
      '%s accepts its own type and loses the row when the claim is deleted (cascade)',
      async (table, { claimType, sql }) => {
        const claimId = await insertClaim(claimType);
        await owner.query(sql, [claimId]);
        await owner.query('DELETE FROM claim WHERE id = $1', [claimId]);
        const left = await owner.query(`SELECT 1 FROM ${table} WHERE claim_id = $1`, [claimId]);
        expect(left.rowCount).toBe(0);
      },
    );

    it('keeps claim_type constant (structural CHECK)', async () => {
      const claimId = await insertClaim('MEASURE');
      const error = await owner
        .query(
          `INSERT INTO village_name (claim_id, claim_type, name, name_normalized, lang, name_type)
           VALUES ($1, 'MEASURE', 'x', 'x', 'ar', 'CURRENT')`,
          [claimId],
        )
        .catch((e: unknown) => e);
      expect((error as DatabaseError).code).toBe('23514');
    });
  });

  describe('projections', () => {
    it('copies the preferred CURRENT Arabic name to display_name_ar in the review transaction', async () => {
      const village = VILLAGES.near.id;
      const claimId = await insertClaim('VILLAGE_NAME', {
        villageId: village,
        groupKey: `name|${village}|ar|current`,
      });
      await owner.query(
        `INSERT INTO village_name (claim_id, name, name_normalized, lang, name_type)
         VALUES ($1, 'عصيرة الشمالية', 'عصيره الشماليه', 'ar', 'CURRENT')`,
        [claimId],
      );
      const before = await villageRow(village);

      await run({ id: claimId, expectedVersion: 1, action: 'VERIFY' });

      const after = await villageRow(village);
      expect(await claimState(claimId)).toMatchObject({ status: 'VERIFIED', is_preferred: true });
      expect(after.display_name_ar).toBe('عصيرة الشمالية');
      expect(after.version).toBe(before.version + 1);
    });

    it('ignores historical names and keeps the name when the preferred one is disputed', async () => {
      const village = VILLAGES.middle.id;
      const current = await insertClaim('VILLAGE_NAME', {
        villageId: village,
        groupKey: `name|${village}|en|current`,
      });
      await owner.query(
        `INSERT INTO village_name (claim_id, name, name_normalized, lang, name_type)
         VALUES ($1, 'Middle', 'middle', 'en', 'CURRENT')`,
        [current],
      );
      await run({ id: current, expectedVersion: 1, action: 'VERIFY' });
      expect((await villageRow(village)).display_name_en).toBe('Middle');

      const historical = await insertClaim('VILLAGE_NAME', {
        villageId: village,
        groupKey: `name|${village}|en|HISTORICAL|old middle`,
      });
      await owner.query(
        `INSERT INTO village_name (claim_id, name, name_normalized, lang, name_type)
         VALUES ($1, 'Old Middle', 'old middle', 'en', 'HISTORICAL')`,
        [historical],
      );
      await run({ id: historical, expectedVersion: 1, action: 'VERIFY' });
      await run({ id: current, expectedVersion: 2, action: 'DISPUTE', note: 'wrong spelling' });

      expect((await villageRow(village)).display_name_en).toBe('Middle');
    });

    it('copies the preferred LOCATION to village.location, announces it after commit and clears it on dispute', async () => {
      const village = VILLAGES.noLocation.id;
      const events: DomainEvent[] = [];
      const publish = publisher.publish.bind(publisher);
      jest.spyOn(publisher, 'publish').mockImplementation((event) => {
        events.push(event);
        return publish(event);
      });
      const claimId = await insertClaim('LOCATION', {
        villageId: village,
        groupKey: `location|${village}`,
      });
      await owner.query(
        `INSERT INTO village_location (claim_id, point, precision)
         VALUES ($1, ST_SetSRID(ST_MakePoint(35.12345, 32.54321), 4326)::geography, 'EXACT')`,
        [claimId],
      );

      await run({ id: claimId, expectedVersion: 1, action: 'VERIFY' });

      expect(await villageRow(village)).toMatchObject({ latitude: 32.54321, longitude: 35.12345 });
      expect(events).toEqual([
        expect.objectContaining({
          name: VILLAGE_LOCATION_CHANGED,
          aggregateId: village,
          payload: { location: { latitude: 32.54321, longitude: 35.12345 } },
        }),
      ]);

      await run({ id: claimId, expectedVersion: 2, action: 'DISPUTE', note: 'off by a valley' });

      expect(await villageRow(village)).toMatchObject({ latitude: null, longitude: null });
      expect(events.at(-1)).toMatchObject({ payload: { location: null } });
    });

    it('rolls the whole review back when the hook fails', async () => {
      const village = VILLAGES.far.id;
      const before = await villageRow(village);
      // A LOCATION claim without its fact row: the projector cannot copy it and throws.
      const claimId = await insertClaim('LOCATION', {
        villageId: village,
        groupKey: `location|${village}`,
      });

      await expect(run({ id: claimId, expectedVersion: 1, action: 'VERIFY' })).rejects.toThrow(
        /has no fact row/,
      );

      expect(await claimState(claimId)).toEqual({
        status: 'UNVERIFIED',
        is_preferred: false,
        version: 1,
      });
      expect(await villageRow(village)).toEqual(before);
    });
  });

  describe('nearby', () => {
    it('returns published villages within the radius, nearest first, without drafts or itself', async () => {
      const result = await cls.run(() =>
        nearby.execute({ villageId: VILLAGES.origin.id, radiusKm: 10, limit: 50, user: undefined }),
      );

      expect(result.map((v) => v.id)).toEqual([VILLAGES.near.id, VILLAGES.middle.id]);
      expect(result[0]!.distanceMeters).toBeGreaterThan(1000);
      expect(result[0]!.distanceMeters).toBeLessThan(result[1]!.distanceMeters);
    });

    it('honours the limit and a larger radius', async () => {
      const result = await cls.run(() =>
        nearby.execute({ villageId: VILLAGES.origin.id, radiusKm: 100, limit: 1, user: undefined }),
      );
      expect(result.map((v) => v.id)).toEqual([VILLAGES.near.id]);
    });

    it('uses the GiST index village_location_gist', async () => {
      await owner.query('BEGIN');
      try {
        await owner.query('SET LOCAL enable_seqscan = off');
        // The query of DrizzleVillageFactRepository.findNearby, with its parameters bound.
        const result = await owner.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT id FROM village
           WHERE publication_status = 'PUBLISHED' AND id <> $1
             AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(35.26, 32.22), 4326)::geography, 10000)
           ORDER BY location <-> ST_SetSRID(ST_MakePoint(35.26, 32.22), 4326)::geography
           LIMIT 10`,
          [VILLAGES.origin.id],
        );
        const plan = result.rows.map((row) => row['QUERY PLAN']).join('\n');
        expect(plan).toContain('village_location_gist');
      } finally {
        await owner.query('ROLLBACK');
      }
    });
  });
});
