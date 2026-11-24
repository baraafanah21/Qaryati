import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/app-env';
import { DatabaseModule } from '../../platform/database/database.module';
import { CLOCK, type Clock } from '../../shared/kernel';
import { ClaimTypeRegistry } from '../curation';
import { AdminUnitQueries } from './application/admin-unit-queries';
import { ChangeVillagePublication } from './application/change-village-publication.use-case';
import { CreateVillage } from './application/create-village.use-case';
import { DeleteVillage } from './application/delete-village.use-case';
import { FindNearbyVillages } from './application/find-nearby-villages.use-case';
import { GetVillage } from './application/get-village.use-case';
import { ListVillageFacts } from './application/list-village-facts.use-case';
import { SearchVillages } from './application/search-villages.use-case';
import { PublishedCurrentNamesReader } from './application/published-current-names';
import { SubmitVillageFact } from './application/submit-village-fact.use-case';
import { UpdateVillage } from './application/update-village.use-case';
import { VillageNameClaims } from './application/village-name-claims.use-case';
import { VillageProjector } from './application/village-projector';
import { VillageQueries } from './application/village-queries';
import { VillageFactWriter } from './application/village-fact-writer';
import { ADMIN_UNIT_REPOSITORY } from './domain/admin-unit';
import { VILLAGE_REPOSITORY } from './domain/village.repository';
import { VILLAGE_FACT_REPOSITORY } from './domain/village-fact.repository';
import { CachedAdminUnitRepository } from './infrastructure/cached-admin-unit.repository';
import { DrizzleAdminUnitRepository } from './infrastructure/drizzle-admin-unit.repository';
import { DrizzleVillageRepository } from './infrastructure/drizzle-village.repository';
import { DrizzleVillageFactRepository } from './infrastructure/drizzle-village-fact.repository';
import * as schema from './infrastructure/persistence/schema';
import { AdminUnitController } from './web/admin-unit.controller';
import { VillageController } from './web/village.controller';
import { VillageFactController } from './web/village-fact.controller';

/**
 * Nest module of village. It wires the module's ports to their adapters and is
 * imported only by AppModule. Global, so content modules can inject the public
 * VillageQueries and AdminUnitQueries without importing this wiring. On start
 * it registers the projection hooks of `VILLAGE_NAME` and `LOCATION` with
 * curation's ClaimTypeRegistry.
 */
@Global()
@Module({
  imports: [DatabaseModule.forFeature(schema)],
  controllers: [VillageController, AdminUnitController, VillageFactController],
  providers: [
    CreateVillage,
    GetVillage,
    UpdateVillage,
    ChangeVillagePublication,
    DeleteVillage,
    PublishedCurrentNamesReader,
    SubmitVillageFact,
    ListVillageFacts,
    VillageNameClaims,
    FindNearbyVillages,
    SearchVillages,
    VillageProjector,
    VillageQueries,
    VillageFactWriter,
    AdminUnitQueries,
    DrizzleAdminUnitRepository,
    { provide: VILLAGE_REPOSITORY, useClass: DrizzleVillageRepository },
    { provide: VILLAGE_FACT_REPOSITORY, useClass: DrizzleVillageFactRepository },
    {
      // Reference data that changes almost never: an in-process cache in front of the database.
      provide: ADMIN_UNIT_REPOSITORY,
      inject: [DrizzleAdminUnitRepository, ConfigService, CLOCK],
      useFactory: (
        inner: DrizzleAdminUnitRepository,
        config: ConfigService<AppEnv, true>,
        clock: Clock,
      ) =>
        new CachedAdminUnitRepository(
          inner,
          config.get('ADMIN_UNITS_CACHE_TTL_SECONDS', { infer: true }),
          clock,
        ),
    },
  ],
  exports: [VillageQueries, VillageFactWriter, AdminUnitQueries],
})
export class VillageModule implements OnModuleInit {
  constructor(
    private readonly claimTypes: ClaimTypeRegistry,
    private readonly projector: VillageProjector,
  ) {}

  onModuleInit(): void {
    this.claimTypes.register({
      claimType: 'VILLAGE_NAME',
      onPreferredChanged: (change) => this.projector.nameChanged(change),
    });
    this.claimTypes.register({
      claimType: 'LOCATION',
      onPreferredChanged: (change) => this.projector.locationChanged(change),
    });
  }
}
