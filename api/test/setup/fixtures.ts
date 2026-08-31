import { randomUUID } from 'node:crypto';

import { type INestApplication, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, type ThrottlerStorageService } from '@nestjs/throttler';
import { sql, type Kysely } from 'kysely';

import { AppModule } from '../../src/app.module';
import { TokensService } from '../../src/auth/tokens.service';
import { configureApp } from '../../src/bootstrap';
import { APP_CONFIG, type AppConfig } from '../../src/config/configuration';
import { EMAIL_PORT } from '../../src/email/email.port';

import { CapturingEmailAdapter } from './capturing-email.adapter';

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

/**
 * **Never take the two ends of an effective-dated period from different clocks.**
 *
 * PostgreSQL's `clock_timestamp()` and Node's `Date.now()` are not one clock, and a
 * period taking one end from each can end before it begins.
 *
 * **The two agree far better than an earlier version of this comment claimed, and the
 * rule survives that.** This said the database ran 6-8ms ahead on this project's Windows
 * machines, and attributed it to PostgreSQL reading `GetSystemTimePreciseAsFileTime`
 * while V8 interpolates from the coarse system tick. Measured against `dfc_ci` over 200
 * samples, `clock_timestamp()` lands a median of 0ms and at most 1ms from a host stamp
 * read *after* the query returns, and inside the bracket either side of it on most
 * samples. The offset that was being read as skew was the query round trip.
 *
 * What makes mixing unsafe is therefore not an offset to be budgeted for but that the
 * two ends are separated by an unbounded interval: the round trip itself, whatever the
 * host clock does between two reads, and — in CI, where the database is a service
 * container — real skew nobody here has measured. A period whose real elapsed time is
 * shorter than that interval inverts, which a local transaction usually is.
 *
 * The mechanism is corrected rather than the rule relaxed. A rule that holds for a
 * stated reason that is false is a rule the next reader will re-derive and discard.
 *
 * A fixture that stamps `started_at` from the database and `ended_at` from the host is
 * exactly that shape, and every `..._period_ordered` check in migrations 0001 and 0009
 * refuses the result — on some runs only, which is what makes it expensive to find.
 *
 * This has been shipped three times on one branch, twice by the fix for the previous
 * instance. The rule is per *period*, not per call site: take both ends from
 * `sql\`clock_timestamp()\``, or both from a host `Date`, or both from a fixed
 * constant like `EPOCH`. Mixing is what fails, and it fails on some runs only.
 */

export async function createPerson(
  db: Kysely<Database>,
  options: {
    firstName: string;
    network: NetworkName;
    lastName?: string;
    /**
     * Optional because most cases do not care, and because two that do care very
     * much: the duplicate matcher tiers on an equal birthday, and the section 8
     * redaction is asserted by two candidates differing in nothing else. A
     * shared default would make those cases unwritable.
     *
     * **`null` and omission differ here**, deliberately: omitted takes the shared
     * default, and an explicit `null` is a Person with no birthday, which
     * section 3 permits and which drops every Tier 1 rule that reads one. The
     * distinction is spelled out because this project has already shipped one
     * defect from `@IsOptional()` treating the two alike.
     */
    birthDate?: string | null;
    /**
     * The one name field the matcher never compares. It tiers on the first and
     * last names, the birthday and the mobile number; sex only annotates
     * (section 3). So this is how a case gives two otherwise identical candidates
     * a distinguishable `full_name` to be ordered by, without changing which of
     * them match or at what tier.
     */
    middleName?: string;
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
      middle_name: options.middleName ?? null,
      last_name: options.lastName ?? 'Testfixture',
      birth_date: options.birthDate === undefined ? '1985-06-15' : options.birthDate,
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
  // A null leader means a Network root, and a root row carries its Network's root
  // seat (section 5, migration 0008). Read here rather than asked of every caller,
  // so that no test can claim the wrong seat and then assert on the result.
  //
  // Read with `network_as_of(person, startedAt)` rather than from the currently
  // open row, because that is what the trigger compares against. The two agree
  // only for a person whose Network has never changed, so taking the open row
  // would present a fixture bug as a trigger failure the first time a test writes
  // a root with a historical `startedAt`.
  const rootNetwork =
    leaderId === null
      ? (
          await sql<{
            network: 'MENS' | 'WOMENS' | null;
          }>`SELECT network_as_of(${personId}::uuid, ${startedAt}) AS network`.execute(db)
        ).rows[0].network
      : null;

  const row = await db
    .insertInto('pastoral_assignments')
    .values({
      person_id: personId,
      leader_id: leaderId,
      root_network: rootNetwork,
      started_at: startedAt,
    })
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
  })
    // **The one provider a test replaces.** Everything else is the deployed
    // wiring, deliberately — but the shipped adapter drops mail and never reveals
    // a token (`src/email/logging-email.adapter.ts`), so an activation could not
    // be completed against it. Swapped here rather than per suite, so no test can
    // accidentally exercise a real sender, and so `app.get(EMAIL_PORT)` reaches
    // the same instance the services were handed.
    .overrideProvider(EMAIL_PORT)
    .useClass(CapturingEmailAdapter)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return app;
}

/**
 * Names the Persons this running application will honour as Senior Pastors
 * (SKILL.md section 7).
 *
 * **Set on the live configuration rather than by overriding the provider**, and
 * the reason is ordering: the identifiers are per-database, a fixture Person does
 * not exist when the application is built, and suites build the application once
 * in `beforeAll` and their people in `beforeEach`. Both readers — provisioning and
 * `AuthorizationService` — read the value at call time, exactly as they would read
 * a deployment's environment, so nothing here exercises a path production does not.
 *
 * **Deliberately not folded into `createAccount`.** Creating an account with the
 * role could name its Person automatically, and every existing case would then go
 * green without anybody deciding it should. The rule is that a `SENIOR_PASTOR` row
 * grants nothing unless its Person is named, and a suite that wants the role has
 * to say so.
 *
 * **It bypasses `loadConfig`'s validation**, so nothing here stops a suite naming
 * three people or a value that is not an identifier. `loadConfig` refuses both, so
 * a scenario built that way is one no deployment can reach — the parsing rules are
 * pinned in `test/unit/senior-pastors.spec.ts` and are not this helper's job.
 */
export function nameSeniorPastors(app: INestApplication, personIds: string[]): void {
  app.get<AppConfig>(APP_CONFIG).seniorPastorPersonIds = personIds.map((id) => id.toLowerCase());
}

/** The captured outbox for an app built by `createTestApp`. */
export function outbox(app: INestApplication): CapturingEmailAdapter {
  return app.get<CapturingEmailAdapter>(EMAIL_PORT);
}

/**
 * Forgets every rate-limit count the application is holding.
 *
 * **Cases share an application, and therefore a source address**, so without this
 * a suite exercising a tightly limited endpoint several times fails on its later
 * cases — and fails in a way that reads as a defect in whatever that case was
 * about rather than as one case borrowing another's budget. That is exactly how
 * this was found: the sixth `forgot-password` in one file returned 429 and the
 * assertion that noticed was about email delivery.
 *
 * Reaching into the storage rather than raising the limits, because the limits are
 * production behaviour: `forgot-password` is deliberately tighter than sign-in
 * (section 24), and loosening it so a test suite fits would be tuning the
 * application to the tests. The endpoint's own limit is pinned deliberately in
 * `accounts.e2e.spec.ts` instead.
 */
export function resetRateLimits(app: INestApplication): void {
  const storage = app.get<ThrottlerStorageService>(ThrottlerStorage);
  storage.storage.clear();
}

export interface TestCell {
  id: string;
  cellId: string;
  leaderId: string;
  /**
   * The configuration the Cell was created with.
   *
   * Returned so a test asserting "the category it already has" reads it from the
   * fixture rather than restating the default. A test that restates it passes if the
   * default changes underneath it and stops testing what its name says.
   */
  category: 'YOUTH' | 'YOUNG_PRO' | 'COUPLE';
  dayOfWeek: number;
  timeOfDay: string;
}

/**
 * An ACTIVE Cell, complete: the Cell, its category row, its schedule row and its
 * leadership assignment, in one statement (SKILL.md section 10, Creating a Cell).
 *
 * **One statement is not tidiness, it is the only way this writes at all.** Three
 * constraints in migration 0009 make a partly-built Cell impossible, and each is
 * one this helper would otherwise trip: an ACTIVE Cell has exactly one open
 * leadership assignment (section 11), and an open category row and an open
 * schedule row (section 10).
 *
 * **The schedule row takes its `started_at` from `cells.created_at` in the same
 * expression**, which is what section 10 asks for by name. The Cell is created
 * part-way through a month, so its first schedule row is legal by the `created_at`
 * half of the rule rather than by the month half -- and equality with a column on
 * another table is exact, so a `created_at DEFAULT now()` beside an
 * application-computed timestamp differs by microseconds and aborts every
 * creation, with a failure that reads as a clock problem rather than as a rule.
 */
export async function createCell(
  db: Kysely<Database>,
  options: {
    leader: TestPerson;
    category?: 'YOUTH' | 'YOUNG_PRO' | 'COUPLE';
    /** ISO 8601: 1 is Monday, 7 is Sunday (section 20). */
    dayOfWeek?: number;
    timeOfDay?: string;
    /**
     * When the Cell came into existence, for a case that needs a Cell with history.
     *
     * `created_at` is immutable once written (`cells_record_is_final`), so a case
     * wanting a Cell that has been running for weeks has to say so here rather than
     * moving the column afterwards. Everything the Cell opens with takes this instant
     * too, which is what section 10 requires and what keeps a backdated fixture a
     * state the application could actually have produced -- rather than one where the
     * leadership row predates the Cell.
     */
    createdAt?: Date;
  },
): Promise<TestCell> {
  const result = await sql<{ id: string; cell_id: string }>`
    WITH new_cell AS (
      INSERT INTO cells (created_at)
      VALUES (coalesce(${options.createdAt ?? null}::timestamptz, now()))
      RETURNING id, cell_id, created_at
    ), category AS (
      INSERT INTO cell_categories (cell_id, category, started_at)
      SELECT id, ${options.category ?? 'YOUTH'}::cell_category, created_at FROM new_cell
    ), schedule AS (
      INSERT INTO cell_schedules (cell_id, day_of_week, time_of_day, started_at)
      SELECT id, ${options.dayOfWeek ?? 6}::smallint, ${options.timeOfDay ?? '19:00'}::time, created_at
        FROM new_cell
    ), leadership AS (
      INSERT INTO cell_leaderships (person_id, cell_id, started_at)
      SELECT ${options.leader.id}::uuid, id, created_at FROM new_cell
    )
    SELECT id, cell_id FROM new_cell
  `.execute(db);

  return {
    id: result.rows[0].id,
    cellId: result.rows[0].cell_id,
    leaderId: options.leader.id,
    category: options.category ?? 'YOUTH',
    dayOfWeek: options.dayOfWeek ?? 6,
    timeOfDay: options.timeOfDay ?? '19:00',
  };
}

/**
 * End a Cell's open category and schedule rows at an instant, the way a closure does
 * (SKILL.md section 10, *What closing does*; migration 0010).
 *
 * `GREATEST(at, started_at)`, so a row that has not started yet -- the incoming half
 * of a schedule change queued for next month -- ends at its own start and is
 * zero-length rather than ending before it began. `CellsClosureService` performs
 * exactly this write; the duplication is deliberate, because a fixture calling the
 * service under test would make every case in `cells.spec.ts` depend on the service
 * rather than on the schema it is measuring.
 *
 * Exported separately from `closeCellDirectly` for the cases that stage a
 * **deliberately partial** closure -- a leadership row left open, a membership
 * outliving its Cell. Those must satisfy every rule except the one they are
 * measuring, or they fail on this one instead and stop testing what they name.
 */
export async function endCellConfigurationWithin(
  trx: Kysely<Database>,
  cellId: string,
  at: Date,
): Promise<void> {
  for (const table of ['cell_categories', 'cell_schedules'] as const) {
    await sql`
      UPDATE ${sql.table(table)}
         SET ended_at = GREATEST(${at}::timestamptz, started_at)
       WHERE cell_id = ${cellId}::uuid
         AND (ended_at IS NULL
              OR ended_at > GREATEST(${at}::timestamptz, started_at))
    `.execute(trx);
  }
}

/**
 * Close a Cell directly, performing all five writes section 10 lists.
 *
 * **Five, not three.** The category and schedule rows joined that list on 2026-08-29
 * and migration 0010 enforces it, so a fixture doing only the first three now leaves
 * a CLOSED Cell with configuration rows still in force and fails at COMMIT on a rule
 * the case is not about. Three copies of the three-write version existed across the
 * suite and all three had to be corrected; this is the one copy that replaced them.
 *
 * It writes the tables directly rather than calling `CellsClosureService`, and that is
 * the point: cases in `test/database/` measure the schema, and a fixture routed
 * through the service would have them measuring the service instead.
 */
export async function closeCellDirectly(
  db: Kysely<Database>,
  cellId: string,
  options: {
    reason:
      | 'MERGED_INTO_ANOTHER_CELL'
      | 'LEADER_STEPPED_DOWN'
      | 'MEMBERS_DISPERSED'
      | 'CREATED_IN_ERROR'
      | 'OTHER';
    note?: string;
    at?: Date;
  },
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const at =
      options.at ??
      (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(trx)).rows[0].now;

    await trx
      .updateTable('cells')
      .set({
        state: 'CLOSED',
        closed_at: at,
        closure_reason: options.reason,
        closure_note: options.note ?? null,
      })
      .where('id', '=', cellId)
      .execute();

    await trx
      .updateTable('cell_leaderships')
      .set({ ended_at: at })
      .where('cell_id', '=', cellId)
      .where('ended_at', 'is', null)
      .execute();

    await trx
      .updateTable('cell_memberships')
      .set({ ended_at: at })
      .where('cell_id', '=', cellId)
      .where('ended_at', 'is', null)
      .execute();

    await endCellConfigurationWithin(trx, cellId, at);
  });
}
