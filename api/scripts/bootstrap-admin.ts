/**
 * Creates the first Admin account (SKILL.md section 6, The first Admin account).
 *
 *   npm run bootstrap:admin -- --email you@example.com --first-name X --last-name Y \
 *                              --sex MALE --civil-status MARRIED [--middle-name Z]
 *
 * **Why this is a command and not an endpoint.** Every account is provisioned by
 * somebody holding `accounts.manage`, which only Admin holds — so the first Admin
 * cannot be provisioned by anybody, and something has to break the circle.
 * Section 7 keeps a closed list of routes reachable without authentication, and an
 * unauthenticated route that mints the most powerful account in the system is the
 * wrong thing to add to it: if its emptiness check is ever wrong, or two requests
 * race it, whoever reaches the server first holds the church's records. A command
 * has no such surface — running it already requires reaching the machine, which is
 * the argument section 2 accepts for the import script's actor check.
 *
 * The writing is in `src/admin/bootstrap/first-admin.ts`, because a script cannot
 * be tested and section 6's rules need something that can fail. This file parses
 * arguments, builds the application, and prints.
 */

import { NestFactory } from '@nestjs/core';
import 'dotenv/config';

import { AppModule } from '../src/app.module';
import { AlreadyBootstrappedError, bootstrapFirstAdmin } from '../src/admin/bootstrap/first-admin';
import { AuditService } from '../src/audit/audit.service';
import { AccountTokensService } from '../src/auth/account-tokens.service';
import { DATABASE, type Db } from '../src/database/database.module';
import { NetworksService } from '../src/networks/networks.service';

import type { BootstrapInput } from '../src/admin/bootstrap/first-admin';
import type { CivilStatus, Sex } from '../src/database/schema';

const SEXES: readonly string[] = ['MALE', 'FEMALE'];
const CIVIL_STATUSES: readonly string[] = ['SINGLE', 'MARRIED', 'WIDOWED'];

const USAGE = `usage: npm run bootstrap:admin -- --email <address> --first-name <name> --last-name <name> --sex MALE|FEMALE --civil-status SINGLE|MARRIED|WIDOWED [--middle-name <name>]

Creates the first Admin account, once, and refuses while any account exists.

The administrator is not placed in the pastoral tree. Section 5 permits that as a
correct permanent state for somebody who administers the system without being
anybody's disciple, and at the moment this runs there is no tree to place them in.
An administrator the church does disciple is placed by an ordinary reassignment
afterwards.`;

function parseArgs(argv: string[]): BootstrapInput | string {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) return `Unexpected argument ${arg}.`;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) return `${arg} needs a value.`;
    values.set(arg.slice(2), next);
    i += 1;
  }

  const known = ['email', 'first-name', 'middle-name', 'last-name', 'sex', 'civil-status'];
  for (const key of values.keys()) {
    if (!known.includes(key)) return `Unknown option --${key}.`;
  }

  for (const key of ['email', 'first-name', 'last-name', 'sex', 'civil-status']) {
    if (!values.get(key)?.trim()) return `--${key} is required.`;
  }

  const sex = values.get('sex')!.trim();
  if (!SEXES.includes(sex)) return '--sex must be exactly MALE or FEMALE.';

  const civilStatus = values.get('civil-status')!.trim();
  if (!CIVIL_STATUSES.includes(civilStatus)) {
    return '--civil-status must be exactly SINGLE, MARRIED or WIDOWED.';
  }

  const email = values.get('email')!.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '--email is not an address.';

  return {
    email,
    firstName: values.get('first-name')!.trim(),
    middleName: values.get('middle-name')?.trim() || null,
    lastName: values.get('last-name')!.trim(),
    sex: sex as Sex,
    civilStatus: civilStatus as CivilStatus,
  };
}

async function main(): Promise<number> {
  const input = parseArgs(process.argv.slice(2));
  if (typeof input === 'string') {
    console.error(`${input}\n\n${USAGE}`);
    return 2;
  }

  // The whole application, so configuration is validated exactly as it is at
  // startup and the reused services are the deployed ones.
  //
  // **`logger: false` is wrong here and was tried first.** Nest reports a failure
  // to build the context through its own logger and then exits, so silencing it
  // turns a misconfiguration — a missing `JWT_SECRET`, say — into an exit code
  // with no output at all, before any `catch` in this file can run. Errors and
  // warnings stay on; startup chatter is what `'log'` would add.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const result = await bootstrapFirstAdmin(
      app.get<Db>(DATABASE),
      {
        tokens: app.get(AccountTokensService),
        audit: app.get(AuditService),
        networks: app.get(NetworksService),
      },
      input,
    );

    // **Printed rather than emailed, and section 6 says why.** If delivery failed
    // for this one account there would be no Admin to re-send from and no way
    // back, since this command refuses to run twice. The operator is the holder
    // and is standing at the machine, so the token is not travelling anywhere it
    // should not.
    console.log(`
Created the first Admin account.

  Person    ${result.memberId}  ${input.firstName} ${input.lastName}  (${result.network}, no pastoral leader — administrator)
  Account   ${result.email}  role ADMIN
  Audit     person.created, account.created, role.granted  (actor: system)

Set your password with this activation token. It expires in 7 days, is single-use,
and is the only copy — the database holds a hash of it and nothing else.

  ${result.activationToken}

  POST /api/v1/auth/activate   { "token": "...", "password": "..." }

This command will refuse to run again while any account exists.
`);

    return 0;
  } catch (error) {
    if (error instanceof AlreadyBootstrappedError) {
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
