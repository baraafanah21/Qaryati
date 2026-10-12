import { Controller, Get } from '@nestjs/common';

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
@Controller('health')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return { status: 'ok' };
  }
}
