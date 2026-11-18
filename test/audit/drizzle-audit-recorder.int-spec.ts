import { Inject, Injectable, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Transactional } from '@nestjs-cls/transactional';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { CLS_ID, ClsService } from 'nestjs-cls';
import { Client } from 'pg';
import { createAppConfigModule } from '../../src/config/app-config.module';
import { AuditModule } from '../../src/modules/audit/audit.module';
import {
  AUDIT_SNAPSHOT_POLICY,
  SNAPSHOT_POLICY,
} from '../../src/modules/audit/domain/snapshot-policy';
import { RequestContext } from '../../src/platform/context/request-context';
import { RequestContextModule } from '../../src/platform/context/request-context.module';
import { InjectModuleDb, type ModuleDb } from '../../src/platform/database/database';
import { DatabaseModule } from '../../src/platform/database/database.module';
import { KernelModule } from '../../src/platform/kernel/kernel.module';
import {
  AUDIT_RECORDER,
  CLOCK,
  FixedClock,
  type AuditEntry,
  type AuditRecorder,
} from '../../src/shared/kernel';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../support/test-database';

// A fake module with one table, written together with its audit entry, the
// way every real write use case does it.
const probeSchema = {
  auditProbe: pgTable('audit_probe', { id: integer().primaryKey(), name: text().notNull() }),
};

@Injectable()
class ProbeUseCase {
  constructor(
    @InjectModuleDb() private readonly db: ModuleDb<typeof probeSchema>,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
  ) {}

  /** Inserts a probe row, records `entry`, then throws if asked to. */
  @Transactional()
  async write(id: number, entry: AuditEntry, failAfter = false): Promise<void> {
    await this.db.insert(probeSchema.auditProbe).values({ id, name: `probe ${id}` });
    await this.audit.record(entry);
    if (failAfter) throw new Error('boom after the audit entry');
  }
}

@Module({ imports: [DatabaseModule.forFeature(probeSchema)], providers: [ProbeUseCase] })
class ProbeModule {}

const widgetCreated = (id: string, name = 'Olive press'): AuditEntry => ({
  action: 'widget.created',
  entityType: 'Widget',
  entityId: id,
  villageId: '00000000-0000-7000-8000-0000000000aa',
  after: { name, passwordHash: 'never stored' },
});

describe('DrizzleAuditRecorder (PostGIS via Testcontainers)', () => {
  let database: TestDatabase;
  let moduleRef: TestingModule;
  let useCase: ProbeUseCase;
  let recorder: AuditRecorder;
  let cls: ClsService;
  let context: RequestContext;
  let owner: Client;
  const clock = new FixedClock('2026-11-16T10:00:00Z');
  const actorId = '00000000-0000-7000-8000-000000000001';

  /** Runs `fn` as one authenticated request with id `req-<n>`, like the CLS middleware does. */
  const asRequest = <T>(requestId: string, fn: () => Promise<T>): Promise<T> =>
    cls.run(() => {
      cls.set(CLS_ID, requestId);
      context.setActorId(actorId);
      return fn();
    });

  const probeCount = async (id: number): Promise<number> => {
    const { rows } = await owner.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM audit_probe WHERE id = $1',
      [id],
    );
    return rows[0]?.n ?? 0;
  };

  const auditRows = async (entityId: string) =>
    (
      await owner.query<Record<string, unknown>>('SELECT * FROM audit_entry WHERE entity_id = $1', [
        entityId,
      ])
    ).rows;

  beforeAll(async () => {
    database = await startTestDatabase();
    owner = new Client({ connectionString: database.ownerUrl });
    await owner.connect();
    await owner.query('CREATE TABLE audit_probe (id integer PRIMARY KEY, name text NOT NULL)');
    process.env.DATABASE_URL = database.appUrl;
    moduleRef = await Test.createTestingModule({
      imports: [
        createAppConfigModule(),
        RequestContextModule,
        KernelModule,
        DatabaseModule,
        AuditModule,
        ProbeModule,
      ],
    })
      .overrideProvider(CLOCK)
      .useValue(clock)
      // The reference module's Widget is a test-only entity type.
      .overrideProvider(AUDIT_SNAPSHOT_POLICY)
      .useValue({ ...SNAPSHOT_POLICY, Widget: ['name', 'passwordHash'] })
      .compile();
    await moduleRef.init();
    useCase = moduleRef.get(ProbeUseCase);
    recorder = moduleRef.get<AuditRecorder>(AUDIT_RECORDER);
    cls = moduleRef.get(ClsService);
    context = moduleRef.get(RequestContext);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await moduleRef?.close();
    await owner?.end();
    await database?.stop();
  });

  it('writes the entry with actor, request id, the clock’s time and the filtered snapshot', async () => {
    await asRequest('req-1', () => useCase.write(1, widgetCreated('w1')));

    expect(await probeCount(1)).toBe(1);
    const rows = await auditRows('w1');
    expect(rows).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        action: 'widget.created',
        entity_type: 'Widget',
        entity_id: 'w1',
        village_id: '00000000-0000-7000-8000-0000000000aa',
        actor_id: actorId,
        request_id: 'req-1',
        occurred_at: new Date('2026-11-16T10:00:00Z'),
        before: null,
        after: { name: 'Olive press' },
      },
    ]);
  });

  it('rolls the change back when the audit insert fails', async () => {
    // jsonb cannot store U+0000, so PostgreSQL rejects the audit insert (22P05).
    await expect(
      asRequest('req-2', () => useCase.write(2, widgetCreated('w2', 'bad\u0000name'))),
    ).rejects.toMatchObject({ cause: { code: '22P05' } });

    expect(await probeCount(2)).toBe(0);
    expect(await auditRows('w2')).toEqual([]);
  });

  it('leaves no audit entry when the change rolls back', async () => {
    await expect(
      asRequest('req-3', () => useCase.write(3, widgetCreated('w3'), true)),
    ).rejects.toThrow('boom');

    expect(await probeCount(3)).toBe(0);
    expect(await auditRows('w3')).toEqual([]);
  });

  it('rolls the change back when the entity type has no allow-list', async () => {
    const unknown = { ...widgetCreated('w4'), entityType: 'Gadget' };
    await expect(asRequest('req-4', () => useCase.write(4, unknown))).rejects.toThrow(
      /"Gadget".*snapshot-policy\.ts/,
    );
    expect(await probeCount(4)).toBe(0);
  });

  it('throws outside a transaction', async () => {
    await expect(asRequest('req-5', () => recorder.record(widgetCreated('w5')))).rejects.toThrow(
      'AuditRecorder.record(widget.created) must run inside @Transactional().',
    );
    expect(await auditRows('w5')).toEqual([]);
  });

  describe('as qaryati_app', () => {
    let app: Client;

    beforeAll(async () => {
      app = new Client({ connectionString: database.appUrl });
      await app.connect();
    });

    afterAll(async () => {
      await app?.end();
    });

    it('connects as qaryati_app', async () => {
      const { rows } = await app.query<{ user: string }>('SELECT current_user AS user');
      expect(rows[0]?.user).toBe('qaryati_app');
    });

    it('may INSERT and SELECT audit entries', async () => {
      await app.query(
        `INSERT INTO audit_entry (id, action, entity_type, entity_id, occurred_at)
         VALUES ('00000000-0000-7000-8000-0000000000f1', 'widget.created', 'Widget', 'w6', now())`,
      );
      const { rows } = await app.query('SELECT id FROM audit_entry WHERE entity_id = $1', ['w6']);
      expect(rows).toHaveLength(1);
    });

    it.each([
      ['UPDATE', "UPDATE audit_entry SET action = 'widget.forged'"],
      ['DELETE', 'DELETE FROM audit_entry'],
      ['TRUNCATE', 'TRUNCATE audit_entry'],
    ])('gets permission denied for %s', async (_, statement) => {
      await expect(app.query(statement)).rejects.toMatchObject({
        code: '42501',
        message: 'permission denied for table audit_entry',
      });
    });
  });
});
