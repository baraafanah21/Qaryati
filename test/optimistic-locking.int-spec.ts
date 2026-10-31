import { Inject, Injectable, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Transactional } from '@nestjs-cls/transactional';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { ClsService } from 'nestjs-cls';
import { Client } from 'pg';
import { createAppConfigModule } from '../src/config/app-config.module';
import { RequestContextModule } from '../src/platform/context/request-context.module';
import { InjectModuleDb, type ModuleDb } from '../src/platform/database/database';
import { DatabaseModule } from '../src/platform/database/database.module';
import {
  deleteWithVersion,
  updateWithVersion,
  versionColumns,
} from '../src/platform/database/versioning';
import {
  CLOCK,
  FixedClock,
  NotFoundError,
  PreconditionFailedError,
  type Clock,
} from '../src/shared/kernel';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from './support/test-database';

const schema = {
  note: pgTable('note', { id: uuid().primaryKey(), body: text().notNull(), ...versionColumns() }),
};

const ID = '00000000-0000-7000-8000-000000000001';
const MISSING = '00000000-0000-7000-8000-0000000000ff';

@Injectable()
class NoteWriter {
  constructor(
    @InjectModuleDb() readonly db: ModuleDb<typeof schema>,
    @Inject(CLOCK) readonly clock: Clock,
  ) {}

  @Transactional()
  update(id: string, version: number, body: string, holdBeforeCommit?: Promise<void>) {
    return updateWithVersion(this, schema.note, id, version, { body }).then(async (row) => {
      await holdBeforeCommit;
      return row;
    });
  }

  @Transactional()
  delete(id: string, version: number) {
    return deleteWithVersion(this, schema.note, id, version);
  }
}

@Module({
  imports: [DatabaseModule.forFeature(schema)],
  providers: [NoteWriter, { provide: CLOCK, useValue: new FixedClock('2026-10-18T10:00:00Z') }],
})
class NoteModule {}

describe('updateWithVersion / deleteWithVersion (PostGIS via Testcontainers)', () => {
  let database: TestDatabase;
  let moduleRef: TestingModule;
  let writer: NoteWriter;
  let cls: ClsService;
  let owner: Client;

  const asRequest = <T>(fn: () => Promise<T>): Promise<T> => cls.run(fn);

  beforeAll(async () => {
    database = await startTestDatabase();
    owner = new Client({ connectionString: database.ownerUrl });
    await owner.connect();
    await owner.query(`
      CREATE TABLE note (
        id uuid PRIMARY KEY, body text NOT NULL,
        version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )`);
    process.env.DATABASE_URL = database.appUrl;
    moduleRef = await Test.createTestingModule({
      imports: [createAppConfigModule(), RequestContextModule, DatabaseModule, NoteModule],
    }).compile();
    await moduleRef.init();
    writer = moduleRef.get(NoteWriter);
    cls = moduleRef.get(ClsService);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  beforeEach(async () => {
    await owner.query('DELETE FROM note');
    await owner.query(
      `INSERT INTO note (id, body, created_at, updated_at) VALUES ($1, 'first', now(), now())`,
      [ID],
    );
  });

  afterAll(async () => {
    await owner?.end();
    await moduleRef?.close();
    await database?.stop();
  });

  it('updates the row, increments the version and sets updated_at from the clock', async () => {
    const row = await asRequest(() => writer.update(ID, 1, 'second'));
    expect(row).toMatchObject({
      id: ID,
      body: 'second',
      version: 2,
      updatedAt: new Date('2026-10-18T10:00:00Z'),
    });
  });

  it('rejects a stale version with PreconditionFailedError (412 VERSION_CONFLICT)', async () => {
    await asRequest(() => writer.update(ID, 1, 'second'));
    await expect(asRequest(() => writer.update(ID, 1, 'stale'))).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    const { rows } = await owner.query('SELECT body, version FROM note');
    expect(rows).toEqual([{ body: 'second', version: 2 }]);
  });

  it('reports a missing row as NotFoundError (404)', async () => {
    await expect(asRequest(() => writer.update(MISSING, 1, 'x'))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('deletes the row with the version check and returns it; a stale version is kept', async () => {
    await expect(asRequest(() => writer.delete(ID, 2))).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    expect((await owner.query('SELECT id FROM note')).rows).toEqual([{ id: ID }]);

    const deleted = await asRequest(() => writer.delete(ID, 1));
    expect(deleted).toMatchObject({ id: ID, body: 'first', version: 1 });
    expect((await owner.query('SELECT id FROM note')).rows).toEqual([]);

    await expect(asRequest(() => writer.update(ID, 1, 'x'))).rejects.toBeInstanceOf(NotFoundError);
    await expect(asRequest(() => writer.delete(ID, 1))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lets exactly one of two concurrent updates with the same version win', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    // The first update takes the row lock and keeps its transaction open.
    const first = asRequest(() => writer.update(ID, 1, 'from A', hold));
    // Give A time to lock the row; B's UPDATE then waits on that lock.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = asRequest(() => writer.update(ID, 1, 'from B'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();

    const results = await Promise.allSettled([first, second]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(PreconditionFailedError);
    const { rows } = await owner.query('SELECT body, version FROM note');
    expect(rows).toEqual([{ body: 'from A', version: 2 }]);
  });
});
