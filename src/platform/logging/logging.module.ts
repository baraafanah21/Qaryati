import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { AppEnv } from '../../config/app-env';
import { createPinoHttpOptions } from './logger-options';

/**
 * Structured logging with pino through nestjs-pino. `main.ts` makes it the
 * Nest logger, so `new Logger(...)` calls land in the same JSON stream, with
 * the request ID attached inside a request (docs/kernel.md, "Logging").
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => ({
        pinoHttp: createPinoHttpOptions({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
        }),
      }),
    }),
  ],
})
export class LoggingModule {}
