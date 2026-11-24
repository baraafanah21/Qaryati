import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/app-env';
import { DatabaseModule } from '../../platform/database/database.module';
import { CLOCK, type Clock } from '../../shared/kernel';
import { EconomyFactClaims } from './application/economy-fact-claims.use-case';
import { EconomyQueries } from './application/economy-queries';
import { ListEconomyFacts } from './application/list-economy-facts.use-case';
import { ListVillagesByProduct } from './application/list-villages-by-product.use-case';
import { ProductCatalog } from './application/product-catalog';
import { SubmitEconomyFact } from './application/submit-economy-fact.use-case';
import { ECONOMY_FACT_REPOSITORY } from './domain/economy-fact.repository';
import { PRODUCT_REPOSITORY } from './domain/product';
import { CachedProductRepository } from './infrastructure/cached-product.repository';
import { DrizzleEconomyFactRepository } from './infrastructure/drizzle-economy-fact.repository';
import { DrizzleProductRepository } from './infrastructure/drizzle-product.repository';
import * as schema from './infrastructure/persistence/schema';
import { EconomyController } from './web/economy.controller';
import { ProductController } from './web/product.controller';

/**
 * Nest module of economy. It wires the module's ports to their adapters and is
 * imported only by AppModule, the composition root. Global, so profile can
 * inject the public EconomyQueries without importing this wiring. Economy
 * keeps no projection, so it registers no ClaimTypeHandler.
 */
@Global()
@Module({
  imports: [DatabaseModule.forFeature(schema)],
  controllers: [ProductController, EconomyController],
  providers: [
    ProductCatalog,
    SubmitEconomyFact,
    ListEconomyFacts,
    EconomyFactClaims,
    ListVillagesByProduct,
    EconomyQueries,
    DrizzleProductRepository,
    { provide: ECONOMY_FACT_REPOSITORY, useClass: DrizzleEconomyFactRepository },
    {
      // Reference data that changes only by migration: an in-process cache in front of the database.
      provide: PRODUCT_REPOSITORY,
      inject: [DrizzleProductRepository, ConfigService, CLOCK],
      useFactory: (
        inner: DrizzleProductRepository,
        config: ConfigService<AppEnv, true>,
        clock: Clock,
      ) =>
        new CachedProductRepository(
          inner,
          config.get('PRODUCTS_CACHE_TTL_SECONDS', { infer: true }),
          clock,
        ),
    },
  ],
  exports: [EconomyQueries],
})
export class EconomyModule {}
