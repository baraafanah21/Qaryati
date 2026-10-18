import { Global, Module } from '@nestjs/common';
import { AUDIT_RECORDER } from '../../shared/kernel';
import { PlaceholderAuditRecorder } from './placeholder-audit-recorder';

/**
 * Binds `AUDIT_RECORDER` to {@link PlaceholderAuditRecorder} for every module.
 *
 * TODO(#20): the audit module provides `AUDIT_RECORDER` globally; remove this
 * module from AppModule and delete src/platform/audit.
 */
@Global()
@Module({
  providers: [{ provide: AUDIT_RECORDER, useClass: PlaceholderAuditRecorder }],
  exports: [AUDIT_RECORDER],
})
export class AuditPlaceholderModule {}
