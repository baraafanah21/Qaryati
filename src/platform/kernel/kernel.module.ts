import { Global, Module } from '@nestjs/common';
import { CLOCK, ID_GENERATOR, SystemClock } from '../../shared/kernel';
import { UuidV7IdGenerator } from './uuid-v7-id-generator';

/**
 * Provides the runtime implementations of the kernel ports to every module:
 * `CLOCK` (system time) and `ID_GENERATOR` (UUIDv7). Tests override either
 * token with `FixedClock` or `SequentialIdGenerator`.
 */
@Global()
@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidV7IdGenerator },
  ],
  exports: [CLOCK, ID_GENERATOR],
})
export class KernelModule {}
