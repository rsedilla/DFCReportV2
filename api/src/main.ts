import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { APP_CONFIG, type AppConfig } from './config/configuration';

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
  // An unset value is legitimate on a fresh installation, which must boot and run
  // the initial import before either Person exists to be named — but on a
  // deployment that has lost it, it strips both Senior Pastors of their authority
  // and produces no error anybody would connect to the cause.
  if (config.seniorPastorPersonIds.length === 0) {
    new Logger('Bootstrap').warn(
      'SENIOR_PASTOR_PERSON_IDS is unset. No SENIOR_PASTOR account can be provisioned, and any ' +
        'existing SENIOR_PASTOR role grants nothing. That is correct before the initial import ' +
        'and wrong afterwards.',
    );
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
