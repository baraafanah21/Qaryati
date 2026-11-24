import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { AUDIT_RECORDER } from '../../shared/kernel';
import { ListAuditEntries } from './application/list-audit-entries.use-case';
import { AUDIT_LOG_READER } from './domain/audit-log';
import { AUDIT_SNAPSHOT_POLICY, SNAPSHOT_POLICY } from './domain/snapshot-policy';
import { DrizzleAuditLogReader } from './infrastructure/drizzle-audit-log.reader';
import { DrizzleAuditRecorder } from './infrastructure/drizzle-audit-recorder';
import * as schema from './infrastructure/persistence/schema';
import { AuditController } from './web/audit.controller';

/**
 * Nest module of audit. Global, so every module's use cases can inject
 * `AUDIT_RECORDER` without importing audit; only AppModule imports it. It also
 * serves the read APIs of #44.
 */
@Global()
@Module({
  imports: [DatabaseModule.forFeature(schema)],
  controllers: [AuditController],
  providers: [
    { provide: AUDIT_SNAPSHOT_POLICY, useValue: SNAPSHOT_POLICY },
    { provide: AUDIT_RECORDER, useClass: DrizzleAuditRecorder },
    { provide: AUDIT_LOG_READER, useClass: DrizzleAuditLogReader },
    ListAuditEntries,
  ],
  exports: [AUDIT_RECORDER],
})
export class AuditModule {}
