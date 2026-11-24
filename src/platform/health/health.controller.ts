import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../database/database';
import { ApiModule } from '../http/openapi';
import { Public } from '../http/public.decorator';
import { SkipRateLimit } from '../http/rate-limit.decorators';
import { REDIS } from '../redis/redis.module';

const liveStatus = z.strictObject({ status: z.literal('ok') }).meta({ id: 'LiveStatus' });

const dependency = z.enum(['up', 'down']);
const readyStatus = z
  .strictObject({
    status: z.enum(['ok', 'unavailable']),
    checks: z.strictObject({ database: dependency, redis: dependency }),
  })
  .meta({ id: 'ReadyStatus' });

/** Body of the liveness endpoint. */
export interface LiveStatus {
  status: 'ok';
}

/** Body of the readiness endpoint, also on 503 so an operator sees what is down. */
export type ReadyStatus = z.infer<typeof readyStatus>;

/** A dependency that answers slower than this counts as down. */
const CHECK_TIMEOUT_MS = 1_000;

async function probe(check: () => Promise<unknown>): Promise<'up' | 'down'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Health probes (#43), public and exempt from rate limits:
 *
 * - `GET /api/v1/health/live`: the process accepts HTTP requests. Checks nothing
 *   else, so an orchestrator never restarts the API because PostgreSQL is down.
 * - `GET /api/v1/health/ready`: PostgreSQL (`SELECT 1`) and Redis (`PING`) answer
 *   within a second. 503 when one does not, so a load balancer stops routing here.
 *   The body names the dependency that is down; nothing else (no host, no error).
 */
@ApiModule('health')
@Public()
@SkipRateLimit()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness: the process accepts HTTP requests' })
  @ApiOkResponse({ standardSchema: liveStatus })
  live(): LiveStatus {
    return { status: 'ok' };
  }

  @Get('ready')
  @HttpCode(200)
  @ApiOperation({ summary: 'Readiness: PostgreSQL and Redis answer' })
  @ApiOkResponse({ standardSchema: readyStatus, description: 'Every dependency is up.' })
  @ApiServiceUnavailableResponse({
    standardSchema: readyStatus,
    description: 'At least one dependency is down; checks names it.',
  })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadyStatus> {
    const [database, redis] = await Promise.all([
      probe(() => this.pool.query('SELECT 1')),
      probe(() => this.redis.ping()),
    ]);
    const ok = database === 'up' && redis === 'up';
    if (!ok) res.status(503);
    return { status: ok ? 'ok' : 'unavailable', checks: { database, redis } };
  }
}
