import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { AppEnv } from '../../config/app-env';
import { DRIZZLE, PG_POOL, type Database } from './database';

const logger = new Logger('Database');

/**
 * Provides the typed Drizzle instance (`DRIZZLE`) to every module.
 *
 * - Connects with `DATABASE_URL`, the restricted runtime role `qaryati_app`.
 * - Checks the connection at startup, so a wrong URL or password stops the app
 *   immediately instead of failing on the first request, and logs the role it
 *   connected as.
 * - Closes the pool on shutdown (shutdown hooks are enabled in configureApp).
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
        pool.on('error', (error) => logger.error('Idle database client failed', error.stack));
        return pool;
      },
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => drizzle({ client: pool, casing: 'snake_case' }),
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    const { rows } = await this.pool.query<{ role: string }>('SELECT current_user AS role');
    logger.log(`Connected to PostgreSQL as ${rows[0]?.role}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
