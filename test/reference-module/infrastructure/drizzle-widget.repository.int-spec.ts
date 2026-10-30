// Reference: copy the repository integration test: real PostGIS, the table created as owner, the code under test on qaryati_app.
import { Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { createAppConfigModule } from '../../../src/config/app-config.module';
import { RequestContextModule } from '../../../src/platform/context/request-context.module';
import { DatabaseModule } from '../../../src/platform/database/database.module';
import {
  asId,
  CLOCK,
  FixedClock,
  NotFoundError,
  PreconditionFailedError,
  SequentialIdGenerator,
} from '../../../src/shared/kernel';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../support/test-database';
import { Widget } from '../domain/widget';
import { DrizzleWidgetRepository } from './drizzle-widget.repository';
import * as schema from './persistence/schema';
import { createWidgetTable } from './persistence/widget-table';

const clock = new FixedClock('2026-10-18T10:00:00Z');

@Module({
  imports: [DatabaseModule.forFeature(schema)],
  providers: [DrizzleWidgetRepository, { provide: CLOCK, useValue: clock }],
})
class RepositoryModule {}

describe('DrizzleWidgetRepository (PostGIS via Testcontainers)', () => {
  let database: TestDatabase;
  let moduleRef: TestingModule;
  let repository: DrizzleWidgetRepository;
  const ids = new SequentialIdGenerator();

  const newWidget = (name: string) =>
    Widget.create({ id: ids.next<'Widget'>(), name, now: clock.now() });

  beforeAll(async () => {
    database = await startTestDatabase();
    await createWidgetTable(database.ownerUrl);
    process.env.DATABASE_URL = database.appUrl;
    moduleRef = await Test.createTestingModule({
      imports: [createAppConfigModule(), RequestContextModule, DatabaseModule, RepositoryModule],
    }).compile();
    await moduleRef.init();
    repository = moduleRef.get(DrizzleWidgetRepository);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await moduleRef?.close();
    await database?.stop();
  });

  it('inserts and finds a widget, mapping the row back to the aggregate', async () => {
    const stored = await repository.insert(newWidget('Olive press'));
    const found = await repository.findById(stored.id);
    expect(found).toBeInstanceOf(Widget);
    expect(found).toMatchObject({ id: stored.id, name: 'Olive press', version: 1 });
    expect(found?.createdAt).toEqual(clock.now());
  });

  it('returns undefined for an unknown id', async () => {
    await expect(
      repository.findById(asId<'Widget'>('00000000-0000-7000-8000-0000000000ff')),
    ).resolves.toBeUndefined();
  });

  it('updates with the expected version and increments it', async () => {
    const stored = await repository.insert(newWidget('Mill'));
    const updated = await repository.update(stored.rename('Water mill'), 1);
    expect(updated).toMatchObject({ name: 'Water mill', version: 2 });
    await expect(repository.update(stored.rename('Stale'), 1)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
  });

  it('deletes: a stale version keeps the widget; then it disappears and its name becomes free again', async () => {
    const stored = await repository.insert(newWidget('Press'));
    await expect(repository.delete(stored.id, 2)).rejects.toBeInstanceOf(PreconditionFailedError);
    await expect(repository.delete(stored.id, 1)).resolves.toMatchObject({
      id: stored.id,
      name: 'Press',
    });
    await expect(repository.findById(stored.id)).resolves.toBeUndefined();
    await expect(repository.delete(stored.id, 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repository.insert(newWidget('Press'))).resolves.toMatchObject({ name: 'Press' });
  });

  it('rejects a duplicate name through the unique index (SQLSTATE 23505)', async () => {
    await repository.insert(newWidget('Unique'));
    await expect(repository.insert(newWidget('Unique'))).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23505' }) as unknown,
    });
  });

  it('pages and sorts with the allow-list, counting only live widgets', async () => {
    const page = await repository.list({
      page: 0,
      size: 2,
      sort: [{ field: 'name', direction: 'asc' }],
    });
    // Stored: Olive press, Water mill, Press, Unique (the first Press was deleted for good).
    expect(page.page).toEqual({ number: 0, size: 2, totalElements: 4, totalPages: 2 });
    expect(page.content.map((w) => w.name)).toEqual(['Olive press', 'Press']);
  });
});
