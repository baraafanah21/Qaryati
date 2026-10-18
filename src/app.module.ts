import { Module } from '@nestjs/common';
import { createAppConfigModule } from './config/app-config.module';
import { AuditModule } from './modules/audit/audit.module';
import { CurationModule } from './modules/curation/curation.module';
import { EconomyModule } from './modules/economy/economy.module';
import { GeoModule } from './modules/geo/geo.module';
import { HeritageModule } from './modules/heritage/heritage.module';
import { IamModule } from './modules/iam/iam.module';
import { PopulationModule } from './modules/population/population.module';
import { ProfileModule } from './modules/profile/profile.module';
import { VillageModule } from './modules/village/village.module';
import { AuditPlaceholderModule } from './platform/audit/audit-placeholder.module';
import { RequestContextModule } from './platform/context/request-context.module';
import { DatabaseModule } from './platform/database/database.module';
import { DomainEventsModule } from './platform/events/domain-events.module';
import { HealthModule } from './platform/health/health.module';
import { HttpPlatformModule } from './platform/http/http-platform.module';
import { KernelModule } from './platform/kernel/kernel.module';
import { LoggingModule } from './platform/logging/logging.module';

/**
 * Composition root of the modular monolith.
 *
 * This is the only file allowed to import every module's Nest module directly;
 * modules themselves reach each other only through `index.ts` (see
 * docs/architecture.md, rule 5).
 */
@Module({
  imports: [
    createAppConfigModule(),
    LoggingModule,
    RequestContextModule,
    HttpPlatformModule,
    KernelModule,
    DatabaseModule,
    DomainEventsModule,
    // TODO(#20): replace with the audit module's AUDIT_RECORDER and delete src/platform/audit.
    AuditPlaceholderModule,
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
