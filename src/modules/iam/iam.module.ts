import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { AppEnv } from '../../config/app-env';
import { CLOCK, type Clock } from '../../shared/kernel';
import { AccessTokenVerifier } from './application/access-token-verifier';
import { PermissionChecker } from './domain/permission-checker';
import { JoseAccessTokenVerifier } from './infrastructure/jose-access-token-verifier';
import { loadJwtKeys } from './infrastructure/jwt-keys';
import { JwtAuthGuard } from './web/jwt-auth.guard';
import { RolesGuard } from './web/roles.guard';

/**
 * Nest module of iam. It wires the module's ports to their adapters and is
 * imported only by AppModule. Global export lets consumers inject the public
 * PermissionChecker without importing this module's wiring or internals.
 */
@Global()
@Module({
  providers: [
    PermissionChecker,
    {
      provide: AccessTokenVerifier,
      inject: [ConfigService, CLOCK],
      useFactory: async (config: ConfigService<AppEnv, true>, clock: Clock) => {
        const keys = await loadJwtKeys(
          config.get('JWT_PRIVATE_KEY_FILE', { infer: true }),
          config.get('JWT_PUBLIC_KEY_FILE', { infer: true }),
        );
        return new JoseAccessTokenVerifier(keys, config.get('JWT_ISSUER', { infer: true }), clock);
      },
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [PermissionChecker],
})
export class IamModule {}
