import { Injectable, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Transactional } from '@nestjs-cls/transactional';
import { ClsService } from 'nestjs-cls';
import { Client } from 'pg';

import { createAppConfigModule } from '../../src/config/app-config.module';
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

import { ClaimWriter } from '../../src/modules/curation/application/claim-writer';
import { SourceQueries } from '../../src/modules/curation/application/source-queries';
import { Claim } from '../../src/modules/curation/domain/claim';
import { CLAIM_REPOSITORY } from '../../src/modules/curation/domain/claim.repository';
import { DrizzleClaimRepository } from '../../src/modules/curation/infrastructure/drizzle-claim.repository';
import * as schema from '../../src/modules/curation/infrastructure/persistence/schema';

import { InMemoryAuditRecorder } from '../support/in-memory-audit-recorder';

import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../support/test-database';

const clock = new FixedClock('2026-11-02T10:00:00Z');

const OWNER_ID = '00000000-0000-7000-8000-000000000010';
const VILLAGE_ID = '00000000-0000-7000-8000-000000000020';

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
      useValue: {
        next: () => nextWriterId,
      },
    },
    {
      provide: AUDIT_RECORDER,
      useValue: audit,
    },
    {
      provide: SourceQueries,
      useValue: {
        exists: () => Promise.resolve(true),
      },
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

  const ids = new SequentialIdGenerator();

  const newClaim = (groupKey: string, valueHash: string) =>
    Claim.create({
      id: ids.next<'Claim'>(),
      claimType: 'VILLAGE_NAME',
      villageId: VILLAGE_ID,
      groupKey,
      valueHash,
      actorId: OWNER_ID,
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

    const owner = new Client({
      connectionString: database.ownerUrl,
    });

    await owner.connect();

    try {
      await owner.query(
        `INSERT INTO user_account
          (id, email, password_hash, role, status, version, created_at, updated_at)
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
    } finally {
      await owner.end();
    }

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
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
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
    const found = await repository.findById(asId<'Claim'>('00000000-0000-7000-8000-000000000099'));

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

  it('rejects a claim referencing a missing village', async () => {
    const entity = Claim.create({
      id: ids.next<'Claim'>(),
      claimType: 'VILLAGE_NAME',
      villageId: '00000000-0000-7000-8000-000000000099',
      groupKey: 'name|missing-village',
      valueHash: 'missing-village-hash',
      actorId: OWNER_ID,
      now: clock.now(),
    });

    await expect(repository.insert(entity)).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: '23503',
      }) as unknown,
    });
  });

  it('rejects duplicate claims with a null source', async () => {
    const groupKey = `name|${VILLAGE_ID}|duplicate-test`;

    await repository.insert(newClaim(groupKey, 'same-hash'));

    await expect(repository.insert(newClaim(groupKey, 'same-hash'))).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: '23505',
      }) as unknown,
    });
  });

  it('rolls back a claim when the transaction fails', async () => {
    const entity = newClaim(`name|${VILLAGE_ID}|rollback`, 'rollback-hash');

    await expect(cls.run(() => transactionService.insertThenFail(entity))).rejects.toThrow(
      'rollback test',
    );

    const found = await repository.findById(entity.id);

    expect(found).toBeUndefined();
  });

  it('submits a claim and records audit inside the transaction', async () => {
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
