import { Logger, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { RecordedMeetingsBindingModule } from '../../src/attendance/recorded-meetings.binding.module';
import { configureApp } from '../../src/bootstrap';
import { RECORDED_MEETINGS_PORT } from '../../src/cells/recorded-meetings.port';
import { EMAIL_PORT } from '../../src/email/email.port';
import { CapturingEmailAdapter } from '../setup/capturing-email.adapter';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createCell, createPerson } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

/**
 * What the Cells index does when the recorded-meetings port is not bound (SKILL.md
 * section 2; `cells/recorded-meetings.port.ts`).
 *
 * **A suite of its own because no other case can reach this.** Every other test builds
 * the real `AppModule`, which binds the port, so the fail-closed branch is unreachable
 * through `createTestApp` and a mutation removing it leaves the whole suite green.
 * Section 2 requires an inversion port to have exactly this case: "each inversion port
 * has one case exercising its unbound refusal — that branch is unreachable through a
 * normally built application, so nothing else can reach it."
 *
 * **Two unbound states, and only one of them is what a deployment produces.** A missing
 * binding module leaves an `@Optional()` token resolving to `undefined`; a provider
 * overridden in a test resolves to `null`, because `useValue(undefined)` does not
 * override at all — Nest reads an undefined value as no value and falls through to the
 * real provider. `CellsIndexService` therefore tests the field for falsiness, and **both
 * states are exercised below, in two blocks**.
 *
 * **What the second block buys, stated as the mutation it fails on rather than as a
 * hope.** Removing `@Optional()` from `CellsIndexService`: section 2 requires an unbound
 * inversion port to cost one operation rather than the whole application, and without
 * that decorator Nest cannot build the application at all when the binding is absent.
 * Run against this suite, that mutation fails the two cases below and leaves the `null`
 * case green — so the suite as it first stood passed through it entire.
 *
 * *It is deliberately not claimed that the second block catches a `=== null` check, which
 * is the defect `ADMIN_ACCOUNTS_PORT` shipped with. That cannot be written here:
 * `recorded` is declared `?:`, so its type holds no `null` and the comparison is a type
 * error. The admin-accounts field is declared `| null`, which is what let the dead check
 * compile there.*
 *
 * *The first version of this suite reached `null` only and asserted in a comment that
 * `undefined` was unreachable from a test. That was false: `TestingModuleBuilder` carries
 * `overrideModule`, which replaces the binding module itself and reproduces the
 * deployment fault exactly. It is the same omission `admin-accounts-port-unbound` shipped
 * with and had corrected, named there as standing here.*
 *
 * **What refusing buys.** The alternative reading is to skip the port and publish the
 * denominator alone, which would answer `0 of 5 meetings recorded` for every Cell in the
 * church — a coverage line section 12 makes the evidence that a leader reported nothing,
 * manufactured here by a missing provider. That is the fail-open hole section 2 describes
 * as turning a wiring fault into a silent hole in whatever rule the port was answering.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */

/** Replaces `RecordedMeetingsBindingModule`, binding nothing, so the token resolves to `undefined`. */
@Module({})
class NoRecordedMeetingsBinding {}

/** A root, a leader beneath them, and one Cell that leader holds. Returns the leader's account. */
const buildFixture = async (app: INestApplication, db: Kysely<Database>): Promise<TestAccount> => {
  const root = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
  await assignTo(db, root.id, null);

  const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
  await assignTo(db, mark.id, root.id);
  await createCell(db, { leader: mark, dayOfWeek: 6 });

  return createAccount(app, db, { person: mark, roles: ['LEADER'] });
};

describe('the Cells index with the recorded-meetings port unbound (section 2)', () => {
  let db: Kysely<Database>;
  /** Everything the exception filter logs at `error` during a case. */
  let logged: string[];
  let loggerSpy: jest.SpyInstance;

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);

    logged = [];
    loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => String(arg)).join(' '));
    });
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  afterAll(async () => {
    await db.destroy();
  });

  const listCells = async (app: INestApplication, as: TestAccount): Promise<request.Response> =>
    request(app.getHttpServer())
      .get('/api/v1/cells')
      .query({ month: '2026-09-01' })
      .set('Authorization', `Bearer ${as.accessToken}`);

  // ---------------------------------------------------------------------------
  // The deployment fault: the binding module is missing, so the token is `undefined`
  // ---------------------------------------------------------------------------

  describe('with the binding module absent, which is what a deployment produces', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(EMAIL_PORT)
        .useClass(CapturingEmailAdapter)
        // The one line under test, and the only way to reach `undefined`: replacing the
        // module that binds the token, rather than overriding the token with a value.
        .overrideModule(RecordedMeetingsBindingModule)
        .useModule(NoRecordedMeetingsBinding)
        .compile();

      app = moduleRef.createNestApplication();
      configureApp(app);
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('refuses the listing rather than publishing a coverage line with no numerator', async () => {
      const leader = await buildFixture(app, db);

      const response = await listCells(app, leader);

      // 500 rather than a 4xx: an unbound provider is a deployment fault and nothing the
      // caller did, and it is fixed by a redeploy after which the same request succeeds.
      // This is a `GET`, so section 22's store-the-4xx rule does not reach it either way;
      // the status says what kind of fault it is.
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');

      // **The log, because the status alone distinguishes nothing.** `INTERNAL_ERROR`
      // carries a fixed body, so a deliberate refusal and a `TypeError` from a missing
      // guard render identically — which is the mutation this assertion exists to catch.
      // What it pins is one substring appearing somewhere in `Logger.error` output during
      // the case: not the level, not the source, and not that the message calls itself a
      // deployment fault. Sufficient for that mutation and weaker than "an operator can
      // diagnose this" would suggest.
      expect(logged.join(' ')).toContain('RECORDED_MEETINGS_PORT');
    });

    it('refuses even where the actor’s scope holds no Cell at all', async () => {
      // **The empty page is the case a naive guard misses.** Asking the port only when
      // there are rows to ask about would hide a wiring fault behind every empty scope, and
      // an empty scope is the ordinary state of a leader who oversees nobody — so the fault
      // would surface for some leaders and not others, which is worse than surfacing for
      // none.
      const stranger = await createPerson(db, { firstName: 'Ruth', network: 'WOMENS' });
      await assignTo(db, stranger.id, null);
      const account = await createAccount(app, db, { person: stranger, roles: ['LEADER'] });

      const response = await listCells(app, account);

      expect(response.status).toBe(500);
      expect(logged.join(' ')).toContain('RECORDED_MEETINGS_PORT');
    });
  });

  // ---------------------------------------------------------------------------
  // The injected state: a test overriding the provider, which resolves to `null`
  // ---------------------------------------------------------------------------

  describe('with the provider overridden to null, which is what a test can inject', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(EMAIL_PORT)
        .useClass(CapturingEmailAdapter)
        .overrideProvider(RECORDED_MEETINGS_PORT)
        .useValue(null)
        .compile();

      app = moduleRef.createNestApplication();
      configureApp(app);
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('refuses on the other falsy state, so the check cannot narrow to one of them', async () => {
      // **This case is the one an override can write, and it is not the deployment
      // fault.** It pins that the falsiness the guard is written with keeps working for
      // an injected `null`, so a later narrowing to `=== undefined` is caught here rather
      // than passing unnoticed. The block above covers the state a deployment actually
      // produces. Neither case can reach a `=== null` narrowing: the field is declared
      // `?:`, so its type holds no `null` and that comparison is a type error.
      const leader = await buildFixture(app, db);

      const response = await listCells(app, leader);

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(logged.join(' ')).toContain('RECORDED_MEETINGS_PORT');
    });
  });
});
