import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { AUDIT_RECORDER } from '../../shared/kernel';
import { AUDIT_SNAPSHOT_POLICY, SNAPSHOT_POLICY } from './domain/snapshot-policy';
import { DrizzleAuditRecorder } from './infrastructure/drizzle-audit-recorder';
import * as schema from './infrastructure/persistence/schema';

/**
 * Nest module of audit. Global, so every module's use cases can inject
 * `AUDIT_RECORDER` without importing audit; only AppModule imports it.
 */
@Global()
@Module({
  imports: [DatabaseModule.forFeature(schema)],
  providers: [
    { provide: AUDIT_SNAPSHOT_POLICY, useValue: SNAPSHOT_POLICY },
    { provide: AUDIT_RECORDER, useClass: DrizzleAuditRecorder },
  ],
  exports: [AUDIT_RECORDER],
})
export class AuditModule {}
