import { Module } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { Client } from 'pg';

import { createAppConfigModule } from '../../src/config/app-config.module';
import {
  ClaimTypeRegistry,
  type PreferredClaimChange,
} from '../../src/modules/curation/application/claim-type-registry';
import { ListConflicts } from '../../src/modules/curation/application/list-conflicts.use-case';
import { ListReviewQueue } from '../../src/modules/curation/application/list-review-queue.use-case';
import {
  ReviewClaim,
  type ReviewClaimInput,
} from '../../src/modules/curation/application/review-claim.use-case';
import { CLAIM_REPOSITORY } from '../../src/modules/curation/domain/claim.repository';
import { DrizzleClaimRepository } from '../../src/modules/curation/infrastructure/drizzle-claim.repository';
import * as schema from '../../src/modules/curation/infrastructure/persistence/schema';
import { RequestContextModule } from '../../src/platform/context/request-context.module';
import { DatabaseModule } from '../../src/platform/database/database.module';
import { runMigrations } from '../../src/platform/database/migrate';
import {
  asId,
  AUDIT_RECORDER,
  CLOCK,
  ConflictError,
  ErrorCode,
  FixedClock,
} from '../../src/shared/kernel';

import { InMemoryAuditRecorder } from '../support/in-memory-audit-recorder';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../support/test-database';

const AUTHOR = '00000000-0000-7000-8000-000000000c01';
const EDITOR = '00000000-0000-7000-8000-000000000c02';
const EDITOR_2 = '00000000-0000-7000-8000-000000000c03';
const VILLAGE = '00000000-0000-7000-8000-000000000c10';
const VILLAGE_2 = '00000000-0000-7000-8000-000000000c11';
const SOURCE = '00000000-0000-7000-8000-000000000c20';
const SOURCE_2 = '00000000-0000-7000-8000-000000000c21';

const audit = new InMemoryAuditRecorder();

@Module({
  imports: [DatabaseModule.forFeature(schema)],
  providers: [
    ReviewClaim,
    ListReviewQueue,
    ListConflicts,
    ClaimTypeRegistry,
    { provide: CLAIM_REPOSITORY, useClass: DrizzleClaimRepository },
    { provide: CLOCK, useValue: new FixedClock('2026-11-20T10:00:00Z') },
    { provide: AUDIT_RECORDER, useValue: audit },
  ],
})
class ReviewTestModule {}

interface ClaimState {
  status: string;
  is_preferred: boolean;
  version: number;
}

describe('Claim review, queue and conflicts (PostGIS)', () => {
  let database: TestDatabase;
  let moduleRef: TestingModule;
  let owner: Client;
  let review: ReviewClaim;
  let queue: ListReviewQueue;
  let conflicts: ListConflicts;
  let cls: ClsService;
  let questionCounter = 0;

  // The test double of an owner's projection hook; each test sets its behaviour.
  let hook: (change: PreferredClaimChange) => Promise<void>;
  const hookCalls: { change: PreferredClaimChange; inTransaction: boolean }[] = [];

  const run = (
    input: Omit<ReviewClaimInput, 'reviewerId' | 'id'> & { id: string; reviewerId?: string },
  ) => cls.run(() => review.execute({ reviewerId: EDITOR, ...input, id: asId<'Claim'>(input.id) }));

  const newQuestion = (prefix = 'location') => {
    questionCounter += 1;
    return `${prefix}|${VILLAGE}|q${questionCounter}`;
  };

  async function insertClaim(
    groupKey: string,
    options: {
      status?: string;
      preferred?: boolean;
      valueHash?: string;
      sourceId?: string | null;
      claimType?: string;
      villageId?: string;
      createdAt?: string;
    } = {},
  ): Promise<string> {
    const result = await owner.query<{ id: string }>(
      `INSERT INTO claim (id, claim_type, village_id, group_key, value_hash, source_id, status,
         is_preferred, created_by, version, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $9)
       RETURNING id`,
      [
        options.claimType ?? 'LOCATION',
        options.villageId ?? VILLAGE,
        groupKey,
        options.valueHash ?? `hash-${Math.random()}`,
        options.sourceId === undefined ? SOURCE : options.sourceId,
        options.status ?? 'UNVERIFIED',
        options.preferred ?? false,
        AUTHOR,
        options.createdAt ?? '2026-11-01T00:00:00Z',
      ],
    );
    return result.rows[0]!.id;
  }

  async function state(id: string): Promise<ClaimState> {
    const result = await owner.query<ClaimState>(
      'SELECT status, is_preferred, version FROM claim WHERE id = $1',
      [id],
    );
    return result.rows[0]!;
  }

  beforeAll(async () => {
    database = await startTestDatabase();
    await runMigrations(database.ownerUrl);

    owner = new Client({ connectionString: database.ownerUrl });
    await owner.connect();

    for (const [id, role] of [
      [AUTHOR, 'CONTRIBUTOR'],
      [EDITOR, 'EDITOR'],
      [EDITOR_2, 'EDITOR'],
    ] as const) {
      await owner.query(
        `INSERT INTO user_account (id, email, password_hash, role, status, version, created_at, updated_at)
         VALUES ($1, $2, 'hash', $3, 'ACTIVE', 1, now(), now())`,
        [id, `${id}@test.local`, role],
      );
    }
    for (const [id, slug] of [
      [VILLAGE, 'review-village'],
      [VILLAGE_2, 'review-village-2'],
    ] as const) {
      await owner.query(
        `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
           created_by, version, created_at, updated_at)
         VALUES ($1, $2, 'INHABITED', 'DRAFT', 'قرية', $3, 1, now(), now())`,
        [id, slug, AUTHOR],
      );
    }
    for (const id of [SOURCE, SOURCE_2]) {
      await owner.query(
        `INSERT INTO source (id, source_type, title, reliability, created_by, version, created_at, updated_at)
         VALUES ($1, 'BOOK', $2, 4, $3, 1, now(), now())`,
        [id, `Review source ${id}`, AUTHOR],
      );
    }

    process.env.DATABASE_URL = database.appUrl;
    moduleRef = await Test.createTestingModule({
      imports: [createAppConfigModule(), RequestContextModule, DatabaseModule, ReviewTestModule],
    }).compile();
    await moduleRef.init();

    review = moduleRef.get(ReviewClaim);
    queue = moduleRef.get(ListReviewQueue);
    conflicts = moduleRef.get(ListConflicts);
    cls = moduleRef.get(ClsService);

    // The one handler for LOCATION, as the village module will register it (task 04).
    moduleRef.get(ClaimTypeRegistry).register({
      claimType: 'LOCATION',
      onPreferredChanged: (change) => {
        hookCalls.push({
          change,
          inTransaction: TransactionHost.getInstance().isTransactionActive(),
        });
        return hook(change);
      },
    });
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await owner?.end();
    await moduleRef?.close();
    await database?.stop();
  });

  beforeEach(() => {
    audit.clear();
    hookCalls.length = 0;
    hook = () => Promise.resolve();
  });

  describe('verify', () => {
    it('makes the first verified claim preferred and runs the hook in the transaction', async () => {
      const groupKey = newQuestion();
      const id = await insertClaim(groupKey);

      const verified = await run({ id, expectedVersion: 1, action: 'VERIFY' });

      expect(verified.status).toBe('VERIFIED');
      expect(verified.isPreferred).toBe(true);
      expect(await state(id)).toEqual({ status: 'VERIFIED', is_preferred: true, version: 2 });
      expect(hookCalls).toEqual([
        {
          change: {
            villageId: VILLAGE,
            groupKey,
            newPreferredClaimId: id,
            previousPreferredClaimId: null,
          },
          inTransaction: true,
        },
      ]);
      expect(audit.entries).toEqual([
        expect.objectContaining({ action: 'claim.verified', entityId: id, villageId: VILLAGE }),
      ]);
    });

    it('leaves the existing preferred claim of the question in place', async () => {
      const groupKey = newQuestion();
      const preferred = await insertClaim(groupKey, { status: 'VERIFIED', preferred: true });
      const id = await insertClaim(groupKey);

      await run({ id, expectedVersion: 1, action: 'VERIFY' });

      expect(await state(id)).toMatchObject({ status: 'VERIFIED', is_preferred: false });
      expect(await state(preferred)).toMatchObject({ is_preferred: true, version: 1 });
      expect(hookCalls).toHaveLength(0);
    });

    it('rolls the whole review back when the projection hook throws', async () => {
      const groupKey = newQuestion();
      const id = await insertClaim(groupKey);
      hook = () => Promise.reject(new Error('projection failed'));

      await expect(run({ id, expectedVersion: 1, action: 'VERIFY' })).rejects.toThrow(
        'projection failed',
      );

      expect(await state(id)).toEqual({ status: 'UNVERIFIED', is_preferred: false, version: 1 });
      expect(audit.entries).toHaveLength(0);
    });
  });

  describe('prefer', () => {
    it('moves the flag from the old preferred claim in one transaction', async () => {
      const groupKey = newQuestion();
      const old = await insertClaim(groupKey, { status: 'VERIFIED', preferred: true });
      const chosen = await insertClaim(groupKey, { status: 'VERIFIED' });

      await run({ id: chosen, expectedVersion: 1, action: 'PREFER', note: 'Newer survey' });

      expect(await state(old)).toMatchObject({ status: 'VERIFIED', is_preferred: false });
      expect(await state(chosen)).toMatchObject({ status: 'VERIFIED', is_preferred: true });
      expect(hookCalls.map((call) => call.change)).toEqual([
        {
          villageId: VILLAGE,
          groupKey,
          newPreferredClaimId: chosen,
          previousPreferredClaimId: old,
        },
      ]);
      expect(audit.entries).toEqual([
        expect.objectContaining({
          action: 'claim.preferred',
          entityId: chosen,
          after: expect.objectContaining({
            previousPreferredClaimId: old,
            preferenceNote: 'Newer survey',
          }) as unknown,
        }),
      ]);
    });

    it('keeps the old preferred claim when the hook fails', async () => {
      const groupKey = newQuestion();
      const old = await insertClaim(groupKey, { status: 'VERIFIED', preferred: true });
      const chosen = await insertClaim(groupKey, { status: 'VERIFIED' });
      hook = () => Promise.reject(new Error('projection failed'));

      await expect(run({ id: chosen, expectedVersion: 1, action: 'PREFER' })).rejects.toThrow();

      expect(await state(old)).toMatchObject({ is_preferred: true, version: 1 });
      expect(await state(chosen)).toMatchObject({ is_preferred: false, version: 1 });
    });

    it('lets exactly one of two concurrent prefers win', async () => {
      const groupKey = newQuestion();
      const old = await insertClaim(groupKey, { status: 'VERIFIED', preferred: true });
      const first = await insertClaim(groupKey, { status: 'VERIFIED' });
      const second = await insertClaim(groupKey, { status: 'VERIFIED' });
      // Hold each transaction open so both read the old preferred claim before either commits.
      hook = () => new Promise((resolve) => setTimeout(resolve, 300));

      const results = await Promise.allSettled([
        run({ id: first, expectedVersion: 1, action: 'PREFER' }),
        run({ id: second, expectedVersion: 1, action: 'PREFER', reviewerId: EDITOR_2 }),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(ConflictError);
      expect((rejected[0]?.reason as ConflictError).code).toBe(ErrorCode.VERSION_CONFLICT);

      const preferred = await owner.query<{ id: string }>(
        'SELECT id FROM claim WHERE group_key = $1 AND is_preferred',
        [groupKey],
      );
      expect(preferred.rows).toHaveLength(1);
      expect([first, second]).toContain(preferred.rows[0]?.id);
      expect(await state(old)).toMatchObject({ is_preferred: false });
    });
  });

  // A preferred claim is VERIFIED, and VERIFIED -> REJECTED is not a legal transition:
  // an editor disputes it first, which is where the flag goes.
  describe('dispute', () => {
    it('unpublishes the preferred claim and tells the owner there is none', async () => {
      const groupKey = newQuestion();
      const id = await insertClaim(groupKey, { status: 'VERIFIED', preferred: true });

      await run({
        id,
        expectedVersion: 1,
        action: 'DISPUTE',
        note: 'Contradicted by the 1945 census',
      });

      expect(await state(id)).toMatchObject({ status: 'DISPUTED', is_preferred: false });
      expect(hookCalls.map((call) => call.change)).toEqual([
        {
          villageId: VILLAGE,
          groupKey,
          newPreferredClaimId: null,
          previousPreferredClaimId: id,
        },
      ]);
    });
  });

  describe('review queue', () => {
    it('lists claims of one status oldest first, with filters', async () => {
      const village2Question = `location|${VILLAGE_2}|queue`;
      const newer = await insertClaim(village2Question, {
        villageId: VILLAGE_2,
        createdAt: '2026-10-02T00:00:00Z',
      });
      const older = await insertClaim(village2Question, {
        villageId: VILLAGE_2,
        createdAt: '2026-10-01T00:00:00Z',
      });
      await insertClaim(village2Question, {
        villageId: VILLAGE_2,
        status: 'DISPUTED',
        createdAt: '2026-09-01T00:00:00Z',
      });

      const page = await queue.execute({
        status: 'UNVERIFIED',
        villageId: VILLAGE_2,
        page: 0,
        size: 10,
      });

      expect(page.content.map((claim) => claim.id)).toEqual([older, newer]);
      expect(page.page.totalElements).toBe(2);
      // Native SQL returns timestamps as text; the repository must hand back Dates.
      expect(page.content[0]?.createdAt).toEqual(new Date('2026-10-01T00:00:00Z'));

      const disputed = await queue.execute({
        status: 'DISPUTED',
        villageId: VILLAGE_2,
        claimType: 'LOCATION',
        page: 0,
        size: 10,
      });
      expect(disputed.content).toHaveLength(1);
    });

    it('uses the partial index claim_review_queue', async () => {
      await owner.query('BEGIN');
      try {
        await owner.query('SET LOCAL enable_seqscan = off');
        // The query of DrizzleClaimRepository.listReviewQueue, with its parameters bound.
        const result = await owner.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT * FROM claim
           WHERE status IN ('UNVERIFIED', 'DISPUTED') AND status = 'UNVERIFIED'
           ORDER BY created_at, id LIMIT 20`,
        );
        const plan = result.rows.map((row) => row['QUERY PLAN']).join('\n');
        expect(plan).toContain('claim_review_queue');
      } finally {
        await owner.query('ROLLBACK');
      }
    });
  });

  describe('conflicts', () => {
    it('returns a question with two values and not one with a single value', async () => {
      const conflicting = `measure|${VILLAGE_2}|ELEVATION_M`;
      const agreeing = `measure|${VILLAGE_2}|AREA_DUNUM`;
      const a = await insertClaim(conflicting, {
        claimType: 'MEASURE',
        villageId: VILLAGE_2,
        valueHash: 'value-450',
        createdAt: '2026-10-01T00:00:00Z',
      });
      const b = await insertClaim(conflicting, {
        claimType: 'MEASURE',
        villageId: VILLAGE_2,
        valueHash: 'value-470',
        sourceId: SOURCE_2,
        createdAt: '2026-10-02T00:00:00Z',
      });
      // A rejected third value is not live, so it does not count.
      await insertClaim(conflicting, {
        claimType: 'MEASURE',
        villageId: VILLAGE_2,
        valueHash: 'value-999',
        status: 'REJECTED',
      });
      // Same value from two sources: agreement, not a conflict.
      await insertClaim(agreeing, {
        claimType: 'MEASURE',
        villageId: VILLAGE_2,
        valueHash: 'value-1200',
      });
      await insertClaim(agreeing, {
        claimType: 'MEASURE',
        villageId: VILLAGE_2,
        valueHash: 'value-1200',
        sourceId: SOURCE_2,
      });

      const page = await conflicts.execute({
        claimType: 'MEASURE',
        villageId: VILLAGE_2,
        page: 0,
        size: 20,
      });

      expect(page.content).toEqual([
        {
          groupKey: conflicting,
          villageId: VILLAGE_2,
          claimType: 'MEASURE',
          distinctValues: 2,
          claimCount: 2,
          claimIds: [a, b],
        },
      ]);
      expect(page.page.totalElements).toBe(1);
    });
  });
});
