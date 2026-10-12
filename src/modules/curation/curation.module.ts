import { Module } from '@nestjs/common';

/**
 * Nest module of curation. It wires the module's ports to their adapters and is
 * imported only by AppModule, the composition root. Empty until the first
 * curation issue lands.
 */
@Module({})
export class CurationModule {}
