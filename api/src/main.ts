import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { APP_CONFIG, seniorPastorsUnnamedWarning, type AppConfig } from './config/configuration';

/**
 * The API is separately deployable and serves three client surfaces. It is not
 * mounted inside the web application, and never will be: an installed mobile
 * build keeps calling `/api/v1` for months after the web client has moved on
 * (SKILL.md section 2).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);

  configureApp(app);
  app.enableShutdownHooks();

  // **Said out loud, because the alternative is silence** (SKILL.md section 7).
  // The message itself lives in `configuration.ts` so that a test can hold it;
  // this is the one line of it nothing can reach.
  const unnamed = seniorPastorsUnnamedWarning(config);
  if (unnamed !== null) {
    new Logger('Bootstrap').warn(unnamed);
  }

  // CORS is an allowlist. An empty one permits no browser origin at all, which is
  // the right default for an API whose other two clients are phones.
  app.enableCors({
    origin: config.corsAllowedOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  });

  await app.listen(config.port);
}

void bootstrap();
