import { Module } from '@nestjs/common';

/**
 * Nest module of audit. It wires the module's ports to their adapters and is
 * imported only by AppModule, the composition root. Empty until the first
 * audit issue lands.
 */
@Module({})
export class AuditModule {}
