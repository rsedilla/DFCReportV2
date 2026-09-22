import { ValidationPipe, type INestApplication } from '@nestjs/common';
import helmet from 'helmet';

import { ValidationFailedError } from './common/errors/api-error';
import { CanonicalIdentifierPipe } from './common/identifiers';

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
    // Before validation, so every downstream reader — including the DTO
    // transforms and every service below them — sees one spelling of an
    // identifier (SKILL.md section 7). Global rather than per route: a rule that
    // each new `@Param` has to opt into is one the newest route silently escapes.
    new CanonicalIdentifierPipe(),
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Input validation is server-side and a client is never trusted to have
      // validated anything (SKILL.md sections 23 and 24). A rejection leaves as
      // the one error envelope, with VALIDATION_FAILED and the fields at fault.
      exceptionFactory: (errors: ValidationError[]) =>
        new ValidationFailedError('Some fields need correcting.', {
          fields: fieldsAtFault(errors),
        }),
    }),
  );
}

/**
 * One entry per refusal, naming where it is (SKILL.md section 22, decision 0275).
 *
 * `field` stays the top-level property, as it always was; `path` says where inside it,
 * `records[1].correction_reason`, and `problems` carries that member's messages. A
 * nested refusal used to name its container with no message at all.
 */
function fieldsAtFault(
  errors: ValidationError[],
): { field: string; path: string; problems: string[] }[] {
  return errors.flatMap((error) => {
    const leaves = leavesOf(error, error.property);

    // A container refused with nothing beneath it still has an entry, as before.
    return (leaves.length > 0 ? leaves : [{ path: error.property, problems: [] }]).map((leaf) => ({
      field: error.property,
      ...leaf,
    }));
  });
}

function leavesOf(error: ValidationError, path: string): { path: string; problems: string[] }[] {
  const own = Object.values(error.constraints ?? {});

  return [
    ...(own.length > 0 ? [{ path, problems: own }] : []),
    ...(error.children ?? []).flatMap((child) =>
      leavesOf(
        child,
        /^\d+$/.test(child.property) ? `${path}[${child.property}]` : `${path}.${child.property}`,
      ),
    ),
  ];
}
