import { Injectable, Module } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { Client } from 'pg';

import { createAppConfigModule } from '../../src/config/app-config.module';
import { ClaimWriter } from '../../src/modules/curation/application/claim-writer';
import { SourceQueries } from '../../src/modules/curation/application/source-queries';
import { Claim } from '../../src/modules/curation/domain/claim';
import { CLAIM_REPOSITORY } from '../../src/modules/curation/domain/claim.repository';
import { DrizzleClaimRepository } from '../../src/modules/curation/infrastructure/drizzle-claim.repository';
import * as schema from '../../src/modules/curation/infrastructure/persistence/schema';
import { RequestContext } from '../../src/platform/context/request-context';
import { RequestContextModule } from '../../src/platform/context/request-context.module';
import { DatabaseModule } from '../../src/platform/database/database.module';
import { runMigrations } from '../../src/platform/database/migrate';

import {
  asId,
  AUDIT_RECORDER,
  CLOCK,
  ID_GENERATOR,
  FixedClock,
  PreconditionFailedError,
  SequentialIdGenerator,
} from '../../src/shared/kernel';

import { InMemoryAuditRecorder } from '../support/in-memory-audit-recorder';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../support/test-database';

const clock = new FixedClock('2026-11-02T10:00:00Z');

const OWNER_ID = '00000000-0000-7000-8000-000000000010';
const VILLAGE_ID = '00000000-0000-7000-8000-000000000020';
const SOURCE_ID = '00000000-0000-7000-8000-000000000030';
const UNKNOWN_ID = '00000000-0000-7000-8000-000000000099';

const audit = new InMemoryAuditRecorder();

let nextWriterId = asId<'Claim'>('00000000-0000-7000-8000-0000000000a1');

@Injectable()
class ClaimTransactionTestService {
  constructor(private readonly repository: DrizzleClaimRepository) {}

  @Transactional()
  async insertThenFail(entity: Claim): Promise<void> {
    await this.repository.insert(entity);
    throw new Error('rollback test');
  }
}

@Module({
  imports: [DatabaseModule.forFeature(schema)],
  providers: [
    DrizzleClaimRepository,
    ClaimTransactionTestService,
    ClaimWriter,
    {
      provide: CLAIM_REPOSITORY,
      useExisting: DrizzleClaimRepository,
    },
    {
      provide: CLOCK,
      useValue: clock,
    },
    {
      provide: ID_GENERATOR,
      useValue: { next: () => nextWriterId },
    },
    {
      provide: AUDIT_RECORDER,
      useValue: audit,
    },
    {
      provide: SourceQueries,
      useValue: { exists: () => Promise.resolve(true) },
    },
  ],
})
class RepositoryModule {}

describe('DrizzleClaimRepository (PostGIS)', () => {
  let database: TestDatabase;
  let moduleRef: TestingModule;
  let repository: DrizzleClaimRepository;
  let transactionService: ClaimTransactionTestService;
  let writer: ClaimWriter;
  let cls: ClsService;
  let context: RequestContext;
  let owner: Client;
  let app: Client;

  const ids = new SequentialIdGenerator();

  const newClaim = (
    groupKey: string,
    valueHash: string,
    options: {
      villageId?: string;
      sourceId?: string | null;
      actorId?: string;
      claimType?: 'VILLAGE_NAME' | 'POPULATION';
    } = {},
  ) =>
    Claim.create({
      id: ids.next<'Claim'>(),
      claimType: options.claimType ?? 'VILLAGE_NAME',
      villageId: options.villageId ?? VILLAGE_ID,
      groupKey,
      valueHash,
      sourceId: options.sourceId,
      actorId: options.actorId ?? OWNER_ID,
      now: clock.now(),
    });

  const submitAsOwner = (groupKey: string, valueHash: string) =>
    cls.run(() => {
      context.setActorId(OWNER_ID);

      return writer.submit({
        claimType: 'VILLAGE_NAME',
        villageId: VILLAGE_ID,
        groupKey,
        valueHash,
      });
    });

  beforeAll(async () => {
    database = await startTestDatabase();
    await runMigrations(database.ownerUrl);

    owner = new Client({ connectionString: database.ownerUrl });
    await owner.connect();

    await owner.query(
      `INSERT INTO user_account
        (id, email, password_hash, role, status,
         version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1, now(), now())`,
      [OWNER_ID, 'claim-owner@test.local', 'hash', 'CONTRIBUTOR', 'ACTIVE'],
    );

    await owner.query(
      `INSERT INTO village
        (id, slug, settlement_status, publication_status,
         display_name_ar, created_by, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, now(), now())`,
      [VILLAGE_ID, 'claim-test-village', 'EXISTING', 'DRAFT', 'قرية الاختبار', OWNER_ID],
    );

    await owner.query(
      `INSERT INTO source
        (id, source_type, title, reliability, created_by,
         version, created_at, updated_at)
       VALUES ($1, 'BOOK', 'Claim Test Source', 5, $2, 1, now(), now())`,
      [SOURCE_ID, OWNER_ID],
    );

    // Throwaway table demonstrates the composite FK pattern.
    await owner.query(`
      CREATE TABLE claim_fact_probe (
        claim_id uuid PRIMARY KEY,
        claim_type text NOT NULL,
        CONSTRAINT claim_fact_probe_claim_fk
          FOREIGN KEY (claim_id, claim_type)
          REFERENCES claim(id, claim_type)
          ON DELETE CASCADE
      )
    `);

    process.env.DATABASE_URL = database.appUrl;

    moduleRef = await Test.createTestingModule({
      imports: [createAppConfigModule(), RequestContextModule, DatabaseModule, RepositoryModule],
    }).compile();

    await moduleRef.init();

    repository = moduleRef.get(DrizzleClaimRepository);
    transactionService = moduleRef.get(ClaimTransactionTestService);
    writer = moduleRef.get(ClaimWriter);
    cls = moduleRef.get(ClsService);
    context = moduleRef.get(RequestContext);

    app = new Client({ connectionString: database.appUrl });
    await app.connect();
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await moduleRef?.close();
    await database?.stop();
  });

  beforeEach(() => {
    audit.clear();
  });

  it('inserts and retrieves a claim', async () => {
    const stored = await repository.insert(newClaim(`name|${VILLAGE_ID}|first`, 'hash-1'));

    const found = await repository.findById(stored.id);

    expect(found).toBeInstanceOf(Claim);
    expect(found?.id).toBe(stored.id);
    expect(found?.status).toBe('UNVERIFIED');
    expect(found?.version).toBe(1);
  });

  it('returns undefined for an unknown claim', async () => {
    const found = await repository.findById(asId<'Claim'>(UNKNOWN_ID));
    expect(found).toBeUndefined();
  });

  it('updates a claim and increments its version', async () => {
    const stored = await repository.insert(newClaim(`name|${VILLAGE_ID}|version`, 'hash-original'));

    const changed = stored.edit(OWNER_ID, {
      groupKey: stored.data.groupKey,
      valueHash: 'hash-updated',
    });

    const updated = await repository.update(changed, 1);

    expect(updated.data.valueHash).toBe('hash-updated');
    expect(updated.version).toBe(2);

    await expect(repository.update(changed, 1)).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('rejects an unknown village_id (23503)', async () => {
    await expect(
      repository.insert(
        newClaim('name|missing-village', 'missing-village-hash', {
          villageId: UNKNOWN_ID,
        }),
      ),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23503' }) as unknown,
    });
  });

  it('rejects duplicate claims with null source (23505)', async () => {
    const groupKey = `name|${VILLAGE_ID}|duplicate-test`;

    await repository.insert(newClaim(groupKey, 'same-hash'));

    await expect(repository.insert(newClaim(groupKey, 'same-hash'))).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23505' }) as unknown,
    });
  });

  it('rejects preferred UNVERIFIED claims (23514)', async () => {
    const stored = await repository.insert(
      newClaim(`name|${VILLAGE_ID}|check-preferred`, 'check-pref'),
    );

    await expect(
      app.query('UPDATE claim SET is_preferred = true WHERE id = $1', [stored.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects VERIFIED claims without a source (23514)', async () => {
    const stored = await repository.insert(
      newClaim(`name|${VILLAGE_ID}|check-source`, 'check-source'),
    );

    await expect(
      app.query("UPDATE claim SET status = 'VERIFIED' WHERE id = $1", [stored.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects two preferred claims in one group (23505)', async () => {
    const groupKey = `name|${VILLAGE_ID}|preferred-unique`;

    const first = await repository.insert(
      newClaim(groupKey, 'preferred-value-1', { sourceId: SOURCE_ID }),
    );

    const second = await repository.insert(
      newClaim(groupKey, 'preferred-value-2', { sourceId: SOURCE_ID }),
    );

    await app.query(
      `UPDATE claim
       SET status = 'VERIFIED', is_preferred = true
       WHERE id = $1`,
      [first.id],
    );

    await expect(
      app.query(
        `UPDATE claim
         SET status = 'VERIFIED', is_preferred = true
         WHERE id = $1`,
        [second.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('allows a duplicate after the original is WITHDRAWN', async () => {
    const groupKey = `name|${VILLAGE_ID}|withdrawn-duplicate`;

    const original = await repository.insert(newClaim(groupKey, 'withdrawn-value'));

    const withdrawn = original.withdraw(OWNER_ID);
    await repository.update(withdrawn, original.version);

    const replacement = await repository.insert(newClaim(groupKey, 'withdrawn-value'));

    expect(replacement.id).not.toBe(original.id);
  });

  it('rejects an unknown source_id (23503)', async () => {
    await expect(
      repository.insert(
        newClaim(`name|${VILLAGE_ID}|bad-source`, 'bad-source', {
          sourceId: UNKNOWN_ID,
        }),
      ),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23503' }) as unknown,
    });
  });

  it('rejects an unknown created_by (23503)', async () => {
    await expect(
      repository.insert(
        newClaim(`name|${VILLAGE_ID}|bad-author`, 'bad-author', {
          actorId: UNKNOWN_ID,
        }),
      ),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23503' }) as unknown,
    });
  });

  it('restricts deleting a village referenced by claims', async () => {
    await expect(
      owner.query('DELETE FROM village WHERE id = $1', [VILLAGE_ID]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('restricts deleting a source referenced by claims', async () => {
    await repository.insert(
      newClaim(`name|${VILLAGE_ID}|source-restrict`, 'source-restrict', {
        sourceId: SOURCE_ID,
      }),
    );

    await expect(
      owner.query('DELETE FROM source WHERE id = $1', [SOURCE_ID]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('accepts a matching composite claim type', async () => {
    const stored = await repository.insert(
      newClaim(`name|${VILLAGE_ID}|composite-good`, 'composite-good'),
    );

    await owner.query(
      `INSERT INTO claim_fact_probe (claim_id, claim_type)
       VALUES ($1, $2)`,
      [stored.id, 'VILLAGE_NAME'],
    );

    const result = await owner.query<{ claim_id: string }>(
      'SELECT claim_id FROM claim_fact_probe WHERE claim_id = $1',
      [stored.id],
    );

    expect(result.rows[0]?.claim_id).toBe(stored.id);
  });

  it('rejects a mismatched composite claim type (23503)', async () => {
    const stored = await repository.insert(
      newClaim(`name|${VILLAGE_ID}|composite-bad`, 'composite-bad'),
    );

    await expect(
      owner.query(
        `INSERT INTO claim_fact_probe (claim_id, claim_type)
         VALUES ($1, $2)`,
        [stored.id, 'POPULATION'],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('cascades hard-deletion to the typed fact row', async () => {
    const stored = await repository.insert(
      newClaim(`name|${VILLAGE_ID}|composite-cascade`, 'composite-cascade'),
    );

    await owner.query(
      `INSERT INTO claim_fact_probe (claim_id, claim_type)
       VALUES ($1, 'VILLAGE_NAME')`,
      [stored.id],
    );

    await owner.query('DELETE FROM claim WHERE id = $1', [stored.id]);

    const result = await owner.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM claim_fact_probe WHERE claim_id = $1`,
      [stored.id],
    );

    expect(result.rows[0]?.count).toBe(0);
  });

  it('uses claim_review_queue for the review query', async () => {
    await app.query('BEGIN');

    try {
      // Tiny test tables otherwise tend to use a sequential scan.
      await app.query('SET LOCAL enable_seqscan = off');

      const result = await app.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN
         SELECT id
         FROM claim
         WHERE status IN ('UNVERIFIED', 'DISPUTED')
         ORDER BY status, created_at`,
      );

      const plan = result.rows.map((row) => row['QUERY PLAN']).join('\n');

      expect(plan).toContain('claim_review_queue');
    } finally {
      await app.query('ROLLBACK');
    }
  });

  it('allows qaryati_app to insert claims', async () => {
    const entity = newClaim(`name|${VILLAGE_ID}|app-permissions`, 'app-permissions');

    const result = await app.query<{ id: string }>(
      `INSERT INTO claim
        (id, claim_type, village_id, group_key, value_hash,
         created_by, version, created_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, 1, now(), now())
       RETURNING id`,
      [
        entity.id,
        entity.data.claimType,
        entity.data.villageId,
        entity.data.groupKey,
        entity.data.valueHash,
        OWNER_ID,
      ],
    );

    expect(result.rows[0]?.id).toBe(entity.id);
  });

  it('prevents qaryati_app from altering claim', async () => {
    await expect(
      app.query('ALTER TABLE claim ADD COLUMN unauthorized_column text'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('rolls back a claim when the transaction fails', async () => {
    const entity = newClaim(`name|${VILLAGE_ID}|rollback`, 'rollback-hash');

    await expect(cls.run(() => transactionService.insertThenFail(entity))).rejects.toThrow(
      'rollback test',
    );

    expect(await repository.findById(entity.id)).toBeUndefined();
  });

  it('submits a claim and audits it inside the transaction', async () => {
    nextWriterId = asId<'Claim'>('00000000-0000-7000-8000-0000000000a1');

    const result = await submitAsOwner(`name|${VILLAGE_ID}|writer-success`, 'writer-success-hash');

    const stored = await repository.findById(result.id);

    expect(stored).toBeInstanceOf(Claim);
    expect(stored?.status).toBe('UNVERIFIED');
    expect(result.version).toBe(1);

    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      action: 'claim.submitted',
      entityType: 'Claim',
      entityId: result.id,
      villageId: VILLAGE_ID,
      inTransaction: true,
    });
  });

  it('rolls back the claim when audit recording fails', async () => {
    nextWriterId = asId<'Claim'>('00000000-0000-7000-8000-0000000000a2');

    audit.failNext(new Error('audit insert failed'));

    await expect(
      submitAsOwner(`name|${VILLAGE_ID}|writer-audit-failure`, 'writer-failure-hash'),
    ).rejects.toThrow('audit insert failed');

    const stored = await repository.findById(nextWriterId);

    expect(stored).toBeUndefined();
    expect(audit.entries).toHaveLength(0);
  });
});
