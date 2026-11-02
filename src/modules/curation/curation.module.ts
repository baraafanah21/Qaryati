import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';

import { ClaimWriter } from './application/claim-writer';
import { CreateSource } from './application/create-source.use-case';
import { GetSource } from './application/get-source.use-case';
import { ListSources } from './application/list-sources.use-case';
import { SourceQueries } from './application/source-queries';
import { UpdateSource } from './application/update-source.use-case';

import { CLAIM_REPOSITORY } from './domain/claim.repository';
import { SOURCE_REPOSITORY } from './domain/source.repository';

import { DrizzleClaimRepository } from './infrastructure/drizzle-claim.repository';
import { DrizzleSourceRepository } from './infrastructure/drizzle-source.repository';
import * as schema from './infrastructure/persistence/schema';

import { SourceController } from './web/source.controller';

/** Wires the curation module's application and persistence layers. */
@Module({
  imports: [DatabaseModule.forFeature(schema)],
  controllers: [SourceController],
  providers: [
    CreateSource,
    GetSource,
    ListSources,
    UpdateSource,
    SourceQueries,
    ClaimWriter,
    {
      provide: SOURCE_REPOSITORY,
      useClass: DrizzleSourceRepository,
    },
    {
      provide: CLAIM_REPOSITORY,
      useClass: DrizzleClaimRepository,
    },
  ],
  exports: [SourceQueries, ClaimWriter],
})
export class CurationModule {}
