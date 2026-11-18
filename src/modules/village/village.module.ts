import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/app-env';
import { DatabaseModule } from '../../platform/database/database.module';
import { CLOCK, type Clock } from '../../shared/kernel';
import { AdminUnitQueries } from './application/admin-unit-queries';
import { ChangeVillagePublication } from './application/change-village-publication.use-case';
import { CreateVillage } from './application/create-village.use-case';
import { DeleteVillage } from './application/delete-village.use-case';
import { GetVillage } from './application/get-village.use-case';
import { PublishedCurrentNamesReader } from './application/published-current-names';
import { UpdateVillage } from './application/update-village.use-case';
import { VillageQueries } from './application/village-queries';
import { ADMIN_UNIT_REPOSITORY } from './domain/admin-unit';
import { VILLAGE_REPOSITORY } from './domain/village.repository';
import { CachedAdminUnitRepository } from './infrastructure/cached-admin-unit.repository';
import { DrizzleAdminUnitRepository } from './infrastructure/drizzle-admin-unit.repository';
import { DrizzleVillageRepository } from './infrastructure/drizzle-village.repository';
import * as schema from './infrastructure/persistence/schema';
import { AdminUnitController } from './web/admin-unit.controller';
import { VillageController } from './web/village.controller';

/**
 * Nest module of village. It wires the module's ports to their adapters and is
 * imported only by AppModule. Global, so content modules can inject the public
 * VillageQueries and AdminUnitQueries without importing this wiring.
 */
@Global()
@Module({
  imports: [DatabaseModule.forFeature(schema)],
  controllers: [VillageController, AdminUnitController],
  providers: [
    CreateVillage,
    GetVillage,
    UpdateVillage,
    ChangeVillagePublication,
    DeleteVillage,
    PublishedCurrentNamesReader,
    VillageQueries,
    AdminUnitQueries,
    DrizzleAdminUnitRepository,
    { provide: VILLAGE_REPOSITORY, useClass: DrizzleVillageRepository },
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
  exports: [VillageQueries, AdminUnitQueries],
})
export class VillageModule {}
