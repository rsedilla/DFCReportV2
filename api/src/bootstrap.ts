import { ValidationPipe, type INestApplication } from '@nestjs/common';
import helmet from 'helmet';

import { ValidationFailedError } from './common/errors/api-error';

import type { ValidationError } from 'class-validator';

/**
 * Everything a running API has that a bare Nest application does not.
 *
 * It lives apart from `main.ts` so the tests configure an application exactly as
 * production does. A test that exercises a differently configured application
 * tests something nobody deploys.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Input validation is server-side and a client is never trusted to have
      // validated anything (SKILL.md sections 23 and 24). A rejection leaves as
      // the one error envelope, with VALIDATION_FAILED and the fields at fault.
      exceptionFactory: (errors: ValidationError[]) =>
        new ValidationFailedError('Some fields need correcting.', {
          fields: errors.map((error) => ({
            field: error.property,
            problems: Object.values(error.constraints ?? {}),
          })),
        }),
    }),
  );
}
