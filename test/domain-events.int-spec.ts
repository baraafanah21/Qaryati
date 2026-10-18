import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Transactional } from '@nestjs-cls/transactional';
import { ClsService } from 'nestjs-cls';
import { Client } from 'pg';
import { createAppConfigModule } from '../src/config/app-config.module';
import { RequestContextModule } from '../src/platform/context/request-context.module';
import { DatabaseModule } from '../src/platform/database/database.module';
import { OnDomainEvent } from '../src/platform/events/domain-event-publisher';
import { DomainEventsModule } from '../src/platform/events/domain-events.module';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEvent,
  type DomainEventPublisher,
} from '../src/shared/kernel';
import {
  BetaModule,
  BetaRepository,
  betaSchema,
  createFakeModuleTables,
} from './support/fake-modules';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from './support/test-database';

const itemAdded = (id: number): DomainEvent => ({
  name: 'beta.itemAdded',
  occurredAt: new Date('2026-10-18T10:00:00Z'),
  aggregateId: String(id),
  payload: { id },
});

@Injectable()
class AddItem {
  constructor(
    private readonly items: BetaRepository,
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly events: DomainEventPublisher,
  ) {}

  @Transactional()
  async execute(id: number, fail = false): Promise<void> {
    await this.items.db.insert(betaSchema.betaItem).values({ id, title: `item ${id}` });
    await this.events.publish(itemAdded(id));
    if (fail) throw new Error('rolled back after publishing');
  }
}

/** Records each event together with whether its row was committed when it arrived. */
@Injectable()
class ItemListener {
  readonly seen: { id: number; committed: boolean }[] = [];
  failNext = false;
  observer!: Client;

  @OnDomainEvent('beta.itemAdded')
  async onItemAdded(event: DomainEvent): Promise<void> {
    const id = event.payload.id as number;
    // A separate connection sees the row only once the transaction committed.
    const { rowCount } = await this.observer.query('SELECT 1 FROM beta_item WHERE id = $1', [id]);
    this.seen.push({ id, committed: rowCount === 1 });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('listener broke');
    }
  }
}

@Module({ imports: [BetaModule], providers: [AddItem, ItemListener] })
class ItemsModule {}

describe('Domain events after commit (PostGIS via Testcontainers)', () => {
  let database: TestDatabase;
  let moduleRef: TestingModule;
  let addItem: AddItem;
  let listener: ItemListener;
  let publisher: DomainEventPublisher;
  let cls: ClsService;

  const asRequest = <T>(fn: () => Promise<T>): Promise<T> => cls.run(fn);

  beforeAll(async () => {
    database = await startTestDatabase();
    await createFakeModuleTables(database.ownerUrl);
    process.env.DATABASE_URL = database.appUrl;
    moduleRef = await Test.createTestingModule({
      imports: [
        createAppConfigModule(),
        RequestContextModule,
        DatabaseModule,
        DomainEventsModule,
        ItemsModule,
      ],
    }).compile();
    await moduleRef.init();
    addItem = moduleRef.get(AddItem);
    listener = moduleRef.get(ItemListener);
    publisher = moduleRef.get(DOMAIN_EVENT_PUBLISHER);
    cls = moduleRef.get(ClsService);
    listener.observer = new Client({ connectionString: database.appUrl });
    await listener.observer.connect();
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  beforeEach(() => {
    listener.seen.length = 0;
  });

  afterAll(async () => {
    await listener?.observer?.end();
    await moduleRef?.close();
    await database?.stop();
  });

  it('delivers an event published in a transaction only after COMMIT', async () => {
    await asRequest(() => addItem.execute(1));
    expect(listener.seen).toEqual([{ id: 1, committed: true }]);
  });

  it('drops the event when the transaction rolls back', async () => {
    await expect(asRequest(() => addItem.execute(2, true))).rejects.toThrow('rolled back');
    expect(listener.seen).toEqual([]);
  });

  it('delivers at once outside a transaction', async () => {
    await asRequest(() => publisher.publish(itemAdded(99)));
    expect(listener.seen).toEqual([{ id: 99, committed: false }]);
  });

  it('logs a failing listener at error and still completes the use case', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      listener.failNext = true;
      await expect(asRequest(() => addItem.execute(3))).resolves.toBeUndefined();
      expect(listener.seen).toEqual([{ id: 3, committed: true }]);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'beta.itemAdded', aggregateId: '3' }),
        'Domain event listener failed',
      );
    } finally {
      error.mockRestore();
    }
  });
});
