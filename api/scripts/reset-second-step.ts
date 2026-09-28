/**
 * Resets an administrator's second sign-in step (SKILL.md section 6, decision 0302).
 *
 *   npm run reset:second-step -- --email <the administrator's address>
 *
 * **A command rather than a button, so that no administrator can remove another's.** A
 * Senior Pastor's step is reset from their person page by an administrator; an
 * administrator's is reset only here, by somebody who can already reach the server. It
 * ends every session of the account, and the next sign-in sets the step up again.
 *
 * The writing is in `SecondStepService.resetByCommand`, so that it can be tested. It
 * runs under `ts-node` for the reason `bootstrap-admin.ts` gives.
 */

import { NestFactory } from '@nestjs/core';
import 'dotenv/config';

import { AppModule } from '../src/app.module';
import { ApiError } from '../src/common/errors/api-error';
import { SecondStepService } from '../src/auth/second-step.service';

const USAGE = 'usage: npm run reset:second-step -- --email <address>';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--email' || !args[1].includes('@')) {
    console.error(USAGE);
    return 2;
  }
  const email = args[1].trim();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    await app.get(SecondStepService).resetByCommand(email);
    console.log(`
Reset the second sign-in step of ${email}.

Every session of that account has ended. At the next sign-in it sets the step up again:
scan the new QR code, confirm one code, and save the new recovery codes.
Recorded in the audit log as second_step.reset (actor: system).
`);
    return 0;
  } catch (error) {
    if (error instanceof ApiError) {
      console.error(`\n${error.message}\n`);
      return 1;
    }
    throw error;
  } finally {
    await app.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
