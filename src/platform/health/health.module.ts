import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** Technical module exposing the liveness endpoint; holds no business logic. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
