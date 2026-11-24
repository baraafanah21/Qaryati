import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';

import { ClaimQueries } from './application/claim-queries';
import { ClaimTypeRegistry } from './application/claim-type-registry';
import { GetClaim } from './application/get-claim.use-case';
import { ListConflicts } from './application/list-conflicts.use-case';
import { ListReviewQueue } from './application/list-review-queue.use-case';
import { ReviewClaim } from './application/review-claim.use-case';
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

import { ClaimController } from './web/claim.controller';
import { CurationController } from './web/curation.controller';
import { SourceController } from './web/source.controller';

/**
 * Wires the curation module's application and persistence layers. Imported
 * only by AppModule; global so that fact modules can inject the public facades
 * (ClaimWriter, ClaimQueries, SourceQueries, ClaimTypeRegistry) without
 * importing this wiring.
 */
@Global()
@Module({
  imports: [DatabaseModule.forFeature(schema)],
  controllers: [SourceController, ClaimController, CurationController],
  providers: [
    CreateSource,
    GetSource,
    ListSources,
    UpdateSource,
    SourceQueries,
    ClaimWriter,
    ClaimQueries,
    ClaimTypeRegistry,
    GetClaim,
    ReviewClaim,
    ListReviewQueue,
    ListConflicts,
    {
      provide: SOURCE_REPOSITORY,
      useClass: DrizzleSourceRepository,
    },
    {
      provide: CLAIM_REPOSITORY,
      useClass: DrizzleClaimRepository,
    },
  ],
  exports: [SourceQueries, ClaimWriter, ClaimQueries, ClaimTypeRegistry],
})
export class CurationModule {}
