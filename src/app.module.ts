import { Module } from '@nestjs/common';
import { AuditModule } from './modules/audit/audit.module';
import { CurationModule } from './modules/curation/curation.module';
import { EconomyModule } from './modules/economy/economy.module';
import { GeoModule } from './modules/geo/geo.module';
import { HeritageModule } from './modules/heritage/heritage.module';
import { IamModule } from './modules/iam/iam.module';
import { PopulationModule } from './modules/population/population.module';
import { ProfileModule } from './modules/profile/profile.module';
import { VillageModule } from './modules/village/village.module';
import { HealthModule } from './platform/health/health.module';

/**
 * Composition root of the modular monolith.
 *
 * This is the only file allowed to import every module's Nest module directly;
 * modules themselves reach each other only through `index.ts` (see
 * docs/architecture.md, rule 5).
 */
@Module({
  imports: [
    HealthModule,
    IamModule,
    CurationModule,
    AuditModule,
    VillageModule,
    PopulationModule,
    HeritageModule,
    EconomyModule,
    GeoModule,
    ProfileModule,
  ],
})
export class AppModule {}
