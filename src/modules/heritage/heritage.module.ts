import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { HeritageFactClaims } from './application/heritage-fact-claims.use-case';
import { HeritageQueries } from './application/heritage-queries';
import { ListHeritageFacts } from './application/list-heritage-facts.use-case';
import { SubmitHeritageFact } from './application/submit-heritage-fact.use-case';
import { HERITAGE_FACT_REPOSITORY } from './domain/heritage-fact.repository';
import { DrizzleHeritageFactRepository } from './infrastructure/drizzle-heritage-fact.repository';
import * as schema from './infrastructure/persistence/schema';
import { HeritageController } from './web/heritage.controller';

/**
 * Nest module of heritage. It wires the module's ports to their adapters and is
 * imported only by AppModule, the composition root. Global, so profile can
 * inject the public HeritageQueries without importing this wiring. Heritage
 * keeps no projection, so it registers no ClaimTypeHandler.
 */
@Global()
@Module({
  imports: [DatabaseModule.forFeature(schema)],
  controllers: [HeritageController],
  providers: [
    SubmitHeritageFact,
    ListHeritageFacts,
    HeritageFactClaims,
    HeritageQueries,
    { provide: HERITAGE_FACT_REPOSITORY, useClass: DrizzleHeritageFactRepository },
  ],
  exports: [HeritageQueries],
})
export class HeritageModule {}
