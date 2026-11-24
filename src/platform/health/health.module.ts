import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Technical module exposing the liveness and readiness probes; holds no business
 * logic. The pool and the Redis client come from the global Database and Redis
 * modules.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
