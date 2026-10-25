import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { AppEnv } from '../../config/app-env';
import { CLOCK, type Clock } from '../../shared/kernel';
import { DatabaseModule } from '../../platform/database/database.module';
import { AccessTokenIssuer } from './application/access-token-issuer';
import { LoginUser } from './application/login-user.use-case';
import { RegisterUser } from './application/register-user.use-case';
import { PasswordHasher } from './application/password-hasher';
import { RefreshTokenGenerator } from './application/refresh-token-generator';
import { UserAccountRepository } from './domain/user-account.repository';
import { RefreshTokenRepository } from './domain/refresh-token.repository';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { CryptoRefreshTokenGenerator } from './infrastructure/crypto-refresh-token-generator';
import { DrizzleUserAccountRepository } from './infrastructure/drizzle-user-account.repository';
import { DrizzleRefreshTokenRepository } from './infrastructure/drizzle-refresh-token.repository';
import { JoseAccessTokenIssuer } from './infrastructure/jose-access-token-issuer';
import { type JwtKeys } from './infrastructure/jwt-keys';
import * as schema from './infrastructure/persistence/schema';
import { AuthController } from './web/auth.controller';
import { AccessTokenVerifier } from './application/access-token-verifier';
import { PermissionChecker } from './domain/permission-checker';
import { JoseAccessTokenVerifier } from './infrastructure/jose-access-token-verifier';
import { loadJwtKeys } from './infrastructure/jwt-keys';
import { JwtAuthGuard } from './web/jwt-auth.guard';
import { RolesGuard } from './web/roles.guard';

const JWT_KEYS = Symbol('IAM_JWT_KEYS');

/**
 * Nest module of iam. It wires the module's ports to their adapters and is
 * imported only by AppModule. Global export lets consumers inject the public
 * PermissionChecker without importing this module's wiring or internals.
 */
@Global()
@Module({
  imports: [DatabaseModule.forFeature(schema)],
  controllers: [AuthController],
  providers: [
    PermissionChecker,
    RegisterUser,
    LoginUser,
    { provide: UserAccountRepository, useClass: DrizzleUserAccountRepository },
    { provide: RefreshTokenRepository, useClass: DrizzleRefreshTokenRepository },
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: RefreshTokenGenerator, useClass: CryptoRefreshTokenGenerator },
    {
      provide: JWT_KEYS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) =>
        loadJwtKeys(
          config.get('JWT_PRIVATE_KEY_FILE', { infer: true }),
          config.get('JWT_PUBLIC_KEY_FILE', { infer: true }),
        ),
    },
    {
      provide: AccessTokenVerifier,
      inject: [JWT_KEYS, ConfigService, CLOCK],
      useFactory: (keys: JwtKeys, config: ConfigService<AppEnv, true>, clock: Clock) =>
        new JoseAccessTokenVerifier(keys, config.get('JWT_ISSUER', { infer: true }), clock),
    },
    {
      provide: AccessTokenIssuer,
      inject: [JWT_KEYS, ConfigService, CLOCK],
      useFactory: (keys: JwtKeys, config: ConfigService<AppEnv, true>, clock: Clock) =>
        new JoseAccessTokenIssuer(keys, config.get('JWT_ISSUER', { infer: true }), clock),
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [PermissionChecker],
})
export class IamModule {}
