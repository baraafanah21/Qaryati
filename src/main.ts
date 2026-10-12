import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './platform/http/configure-app';

// Fixed until typed configuration lands in #3; only src/config will read the environment.
const PORT = 3000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(PORT);
}

void bootstrap();
