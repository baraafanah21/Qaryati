import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiModule } from '../http/openapi';
import { Public } from '../http/public.decorator';

const healthStatus = z.strictObject({ status: z.literal('ok') }).meta({ id: 'HealthStatus' });

/** Body returned by the liveness endpoint. */
export interface HealthStatus {
  status: 'ok';
}

/**
 * Liveness endpoint: `GET /api/v1/health`.
 *
 * It only proves that the process accepts HTTP requests. It deliberately does
 * not check the database or Redis yet; readiness checks with Terminus replace
 * it in #43.
 */
@ApiModule('health')
@Public()
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness: the process accepts HTTP requests' })
  @ApiOkResponse({ standardSchema: healthStatus })
  check(): HealthStatus {
    return { status: 'ok' };
  }
}
