import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { GetPopulationStats } from './application/get-population-stats.use-case';
import { ListPopulationRecords } from './application/list-population-records.use-case';
import { PopulationQueries } from './application/population-queries';
import { PopulationRecordClaims } from './application/population-record-claims.use-case';
import { SubmitPopulationRecord } from './application/submit-population-record.use-case';
import { POPULATION_REPOSITORY } from './domain/population.repository';
import { DrizzlePopulationRepository } from './infrastructure/drizzle-population.repository';
import * as schema from './infrastructure/persistence/schema';
import { PopulationController } from './web/population.controller';

/**
 * Nest module of population. It wires the module's ports to their adapters and
 * is imported only by AppModule, the composition root. Global, so profile can
 * inject the public PopulationQueries without importing this wiring. Population
 * keeps no projection, so it registers no ClaimTypeHandler.
 */
@Global()
@Module({
  imports: [DatabaseModule.forFeature(schema)],
  controllers: [PopulationController],
  providers: [
    SubmitPopulationRecord,
    PopulationRecordClaims,
    ListPopulationRecords,
    GetPopulationStats,
    PopulationQueries,
    { provide: POPULATION_REPOSITORY, useClass: DrizzlePopulationRepository },
  ],
  exports: [PopulationQueries],
})
export class PopulationModule {}
