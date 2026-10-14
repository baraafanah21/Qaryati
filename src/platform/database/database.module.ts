import {
  Global,
  Inject,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { AppEnv } from '../../config/app-env';
import { MODULE_DB, PG_POOL, type ModuleDb } from './database';

const logger = new Logger('Database');

/**
 * Holder class of the dynamic modules returned by `DatabaseModule.forFeature`.
 * Nest 12 tells dynamic modules apart by object identity, so every call is a
 * separate module with its own `MODULE_DB` (test/database-module.int-spec.ts).
 */
@Module({})
class DatabaseFeatureModule {}

/**
 * Owns the one connection pool of the API and hands each module a Drizzle
 * instance limited to that module's tables.
 *
 * - Connects with `DATABASE_URL`, the restricted runtime role `qaryati_app`.
 * - Checks the connection at startup, so a wrong URL or password stops the app
 *   immediately instead of failing on the first request, and logs the role it
 *   connected as.
 * - Closes the pool on shutdown (shutdown hooks are enabled in configureApp).
 *
 * Imported once by AppModule; modules call {@link DatabaseModule.forFeature}.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>): Pool => {
        const pool = new Pool({
          connectionString: config.get('DATABASE_URL', { infer: true }),
          application_name: 'qaryati-api',
        });
        // Without a listener, an error on an idle client (e.g. the database
        // restarting) is an unhandled 'error' event and kills the process.
        pool.on('error', (err) => logger.error({ err }, 'Idle database client failed'));
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * A Drizzle instance on the shared pool that knows only `schema`, provided
   * as `MODULE_DB` to the importing module. Relational queries
   * (`db.query.village.findMany({ with: { names: true } })`) work on the
   * module's own tables and relations, and other modules' tables are not on
   * `db.query` at all (docs/database.md, "Querying").
   *
   * @param schema everything exported by the module's `schema.ts`
   *   (`import * as schema from './schema'`): tables and `relations(...)`.
   */
  static forFeature<TSchema extends Record<string, unknown>>(schema: TSchema): DynamicModule {
    return {
      module: DatabaseFeatureModule,
      providers: [
        {
          provide: MODULE_DB,
          inject: [PG_POOL],
          useFactory: (pool: Pool): ModuleDb<TSchema> =>
            drizzle({ client: pool, schema, casing: 'snake_case' }),
        },
      ],
      exports: [MODULE_DB],
    };
  }

  async onModuleInit(): Promise<void> {
    const { rows } = await this.pool.query<{ role: string }>('SELECT current_user AS role');
    logger.log(`Connected to PostgreSQL as ${rows[0]?.role}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
