import { Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';

import { createAppConfigModule } from '../../src/config/app-config.module';
import { RequestContextModule } from '../../src/platform/context/request-context.module';
import { DatabaseModule } from '../../src/platform/database/database.module';
import { runMigrations } from '../../src/platform/database/migrate';

import {
  asId,
  CLOCK,
  FixedClock,
  PreconditionFailedError,
  SequentialIdGenerator,
} from '../../src/shared/kernel';

import { Source, type SourceData } from '../../src/modules/curation/domain/source';
import { DrizzleSourceRepository } from '../../src/modules/curation/infrastructure/drizzle-source.repository';
import * as schema from '../../src/modules/curation/infrastructure/persistence/schema';

import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../support/test-database';

const clock = new FixedClock('2026-10-27T10:00:00Z');

@Module({
  imports: [DatabaseModule.forFeature(schema)],
  providers: [DrizzleSourceRepository, { provide: CLOCK, useValue: clock }],
})
class RepositoryModule {}

describe('DrizzleSourceRepository (PostGIS)', () => {
  let database: TestDatabase;
  let moduleRef: TestingModule;
  let repository: DrizzleSourceRepository;

  const ids = new SequentialIdGenerator();

  const sourceData = (changes: Partial<SourceData> = {}): SourceData => ({
    sourceType: 'BOOK',
    title: 'History of Palestinian Villages',
    author: null,
    publisher: null,
    publishedYear: 2020,
    url: null,
    isbn: null,
    reliability: 5,
    notes: null,
    ...changes,
  });

  const newSource = (changes: Partial<SourceData> = {}) =>
    Source.create({
      id: ids.next<'Source'>(),
      data: sourceData(changes),
      actorId: '00000000-0000-7000-8000-000000000010',
      now: clock.now(),
    });

  beforeAll(async () => {
    database = await startTestDatabase();

    // Apply the project's real migrations to the isolated database.
    await runMigrations(database.ownerUrl);

    process.env.DATABASE_URL = database.appUrl;

    moduleRef = await Test.createTestingModule({
      imports: [createAppConfigModule(), RequestContextModule, DatabaseModule, RepositoryModule],
    }).compile();

    await moduleRef.init();
    repository = moduleRef.get(DrizzleSourceRepository);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await moduleRef?.close();
    await database?.stop();
  });

  it('inserts and retrieves a source', async () => {
    const stored = await repository.insert(newSource());

    const found = await repository.findById(stored.id);

    expect(found).toBeInstanceOf(Source);
    expect(found?.id).toBe(stored.id);
    expect(found?.data.title).toBe('History of Palestinian Villages');
    expect(found?.version).toBe(1);
  });

  it('returns undefined for an unknown source', async () => {
    const found = await repository.findById(asId<'Source'>('00000000-0000-7000-8000-000000000099'));

    expect(found).toBeUndefined();
  });

  it('checks whether a source exists', async () => {
    const stored = await repository.insert(newSource({ title: 'Population Census' }));

    await expect(repository.exists(stored.id)).resolves.toBe(true);

    await expect(
      repository.exists(asId<'Source'>('00000000-0000-7000-8000-000000000099')),
    ).resolves.toBe(false);
  });

  it('rejects duplicate live URLs', async () => {
    const url = 'https://example.com/unique-source';

    await repository.insert(newSource({ title: 'First URL Source', url }));

    await expect(
      repository.insert(newSource({ title: 'Duplicate URL Source', url })),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23505' }) as unknown,
    });
  });

  it('rejects duplicate live ISBN values', async () => {
    const isbn = '9780306406157';

    await repository.insert(newSource({ title: 'First Book', isbn }));

    await expect(
      repository.insert(newSource({ title: 'Duplicate Book', isbn })),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23505' }) as unknown,
    });
  });

  it('updates a source and increments its version', async () => {
    const stored = await repository.insert(newSource({ title: 'Original Source' }));

    const changed = stored.update(
      sourceData({ title: 'Updated Source' }),
      '00000000-0000-7000-8000-000000000010',
      clock.now(),
    );

    const updated = await repository.update(changed, 1);

    expect(updated.data.title).toBe('Updated Source');
    expect(updated.version).toBe(2);

    await expect(repository.update(changed, 1)).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('filters sources by type', async () => {
    await repository.insert(
      newSource({
        title: 'Official Census Record',
        sourceType: 'CENSUS',
      }),
    );

    const result = await repository.list({
      page: 0,
      size: 20,
      sort: [{ field: 'title', direction: 'asc' }],
      type: 'CENSUS',
    });

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content.every((item) => item.data.sourceType === 'CENSUS')).toBe(true);
  });

  it('finds a source using fuzzy title search', async () => {
    await repository.insert(newSource({ title: 'Palestinian Heritage Archive' }));

    const result = await repository.list({
      page: 0,
      size: 20,
      sort: [{ field: 'title', direction: 'asc' }],
      q: 'Palestinian Heritge Archive',
    });

    expect(result.content.some((item) => item.data.title === 'Palestinian Heritage Archive')).toBe(
      true,
    );
  });

  it('excludes soft-deleted sources from existence checks', async () => {
    const stored = await repository.insert(newSource({ title: 'Deleted Historical Record' }));

    // Simulate soft deletion using Drizzle ORM.
    await repository.db
      .update(schema.source)
      .set({ deletedAt: clock.now() })
      .where(eq(schema.source.id, stored.id));

    await expect(repository.exists(stored.id)).resolves.toBe(false);

    await expect(repository.findById(stored.id)).resolves.toBeUndefined();
  });
});
