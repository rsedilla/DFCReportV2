import { randomUUID } from 'node:crypto';

import { type INestApplication, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Kysely } from 'kysely';

import { AppModule } from '../../src/app.module';
import { TokensService } from '../../src/auth/tokens.service';
import { configureApp } from '../../src/bootstrap';

import type { AccountRole, Database, NetworkName, Sex } from '../../src/database/schema';

/**
 * Fixture data is invented, always. The church holds records for minors and this
 * repository is public, so no fixture carries a real member's name, birthday or
 * mobile number (CLAUDE.md, Secrets).
 *
 * The given names come from the example tree in CLAUDE.md -- Raymond, Manuel,
 * Mark -- because the eleven authorization cases are written against it. The
 * surnames, dates and email addresses are made up.
 */

export interface TestPerson {
  id: string;
  firstName: string;
  network: NetworkName;
}

export interface TestAccount {
  id: string;
  personId: string;
  email: string;
  accessToken: string;
}

/** Well before anything a test does, so every assignment has a Network in force. */
export const EPOCH = new Date('2020-01-01T00:00:00+08:00');

export async function createPerson(
  db: Kysely<Database>,
  options: {
    firstName: string;
    network: NetworkName;
    lastName?: string;
    startedAt?: Date;
    archived?: boolean;
  },
): Promise<TestPerson> {
  const startedAt = options.startedAt ?? EPOCH;
  const sex: Sex = options.network === 'MENS' ? 'MALE' : 'FEMALE';

  const person = await db
    .insertInto('persons')
    .values({
      id: randomUUID(),
      first_name: options.firstName,
      last_name: options.lastName ?? 'Testfixture',
      birth_date: '1985-06-15',
      sex,
      civil_status: 'SINGLE',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  // Network follows from sex under the homogeneous-network rule, and is stored
  // explicitly and effective-dated rather than derived on every query (section 4).
  await db
    .insertInto('network_assignments')
    .values({ person_id: person.id, network: options.network, started_at: startedAt })
    .execute();

  await db
    .insertInto('person_lifecycle')
    .values({
      person_id: person.id,
      state: options.archived ? 'ARCHIVED' : 'CURRENT',
      reason: options.archived ? 'NO_LONGER_IN_CURRENT_NETWORK' : null,
      started_at: startedAt,
    })
    .execute();

  return { id: person.id, firstName: options.firstName, network: options.network };
}

/**
 * Opens a pastoral assignment. A null leader is a Network root, which is the
 * intended state for the two Senior Pastors and for nobody else (section 5).
 */
export async function assignTo(
  db: Kysely<Database>,
  personId: string,
  leaderId: string | null,
  startedAt: Date = EPOCH,
): Promise<string> {
  const row = await db
    .insertInto('pastoral_assignments')
    .values({ person_id: personId, leader_id: leaderId, started_at: startedAt })
    .returning('id')
    .executeTakeFirstOrThrow();

  return row.id;
}

export async function createAccount(
  app: INestApplication,
  db: Kysely<Database>,
  options: {
    person: TestPerson;
    roles: AccountRole[];
    passwordHash?: string;
    /**
     * The account that granted the roles. Null is reserved by SKILL.md section 7
     * for a system action, which is the first Admin account and nothing else.
     */
    grantedBy?: string;
    /**
     * Which of the two Senior Pastor slots this account occupies. Required when
     * granting SENIOR_PASTOR and meaningless otherwise (SKILL.md section 7).
     */
    seniorPastorSlot?: 1 | 2;
  },
): Promise<TestAccount> {
  const email = `${options.person.firstName.toLowerCase()}.${randomUUID().slice(0, 8)}@example.test`;

  const account = await db
    .insertInto('accounts')
    .values({
      person_id: options.person.id,
      email,
      email_normalized: email,
      // An account cannot be ACTIVE without a password. Tests that sign in supply
      // a real hash; the rest mint an access token directly.
      password_hash: options.passwordHash ?? 'argon2-placeholder-not-a-valid-hash',
      status: 'ACTIVE',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  for (const role of options.roles) {
    await db
      .insertInto('account_roles')
      .values({
        account_id: account.id,
        role,
        granted_by: options.grantedBy ?? null,
        senior_pastor_slot: role === 'SENIOR_PASTOR' ? (options.seniorPastorSlot ?? 1) : null,
      })
      .execute();
  }

  const tokens = app.get(TokensService);

  return {
    id: account.id,
    personId: options.person.id,
    email,
    accessToken: tokens.issueAccessToken(account.id, options.person.id),
  };
}

/**
 * An application configured exactly as `main.ts` configures the deployed one.
 * A test against a differently configured application tests something nobody
 * deploys.
 */
export async function createTestApp(controllers: Type<unknown>[] = []): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers,
  }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return app;
}
