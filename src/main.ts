import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { AppEnv } from './config/app-env';
import { configureApp } from './platform/http/configure-app';

async function bootstrap(): Promise<void> {
  // Buffer startup logs until the pino logger is ready, so every line is JSON.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
