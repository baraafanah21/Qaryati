import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';

import { CreateSource } from './application/create-source.use-case';
import { GetSource } from './application/get-source.use-case';
import { ListSources } from './application/list-sources.use-case';
import { SourceQueries } from './application/source-queries';
import { UpdateSource } from './application/update-source.use-case';

import { SOURCE_REPOSITORY } from './domain/source.repository';
import { DrizzleSourceRepository } from './infrastructure/drizzle-source.repository';
import * as schema from './infrastructure/persistence/schema';

import { SourceController } from './web/source.controller';

/** Wires the curation module's HTTP, application and persistence layers. */
@Module({
  imports: [DatabaseModule.forFeature(schema)],
  controllers: [SourceController],
  providers: [
    CreateSource,
    GetSource,
    ListSources,
    UpdateSource,
    SourceQueries,
    {
      provide: SOURCE_REPOSITORY,
      useClass: DrizzleSourceRepository,
    },
  ],
  exports: [SourceQueries],
})
export class CurationModule {}
