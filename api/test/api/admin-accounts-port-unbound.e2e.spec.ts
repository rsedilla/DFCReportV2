import { Logger, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { AdminAccountsBindingModule } from '../../src/auth/admin-accounts.binding.module';
import { configureApp } from '../../src/bootstrap';
import { EMAIL_PORT } from '../../src/email/email.port';
import { ADMIN_ACCOUNTS_PORT } from '../../src/people/admin-accounts.port';
import { CapturingEmailAdapter } from '../setup/capturing-email.adapter';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * What the awaiting-reassignment list does when the admin-accounts port is not bound
 * (SKILL.md sections 2, 5 and 20; `people/admin-accounts.port.ts`; decision 0241).
 *
 * **A suite of its own because no other case can reach this.** Every other test builds the
 * real `AppModule`, which binds the port, so the fail-closed branch is unreachable through
 * `createTestApp` and a mutation removing it leaves the whole suite green. Section 2
 * requires exactly this case of an inversion port: "each inversion port has one case
 * exercising its unbound refusal — that branch is unreachable through a normally built
 * application, so nothing else can reach it."
 *
 * **Two unbound states, and only one of them is what a deployment produces.** A missing
 * binding module leaves an `@Optional()` token resolving to `undefined`; a provider
 * overridden in a test resolves to `null`, because `useValue(undefined)` does not override
 * at all — Nest reads an undefined value as no value and falls through to the real
 * provider. The service therefore tests the field for falsiness, and **both states are
 * exercised below, in two blocks**, because a suite that reached only `null` could not fail
 * on the defect this port actually shipped with: a `=== null` check, dead on the one fault
 * that produces an unbound port.
 *
 * *The first version of this suite reached `null` only, and asserted in a comment that
 * `undefined` was unreachable from a test. That was false — `TestingModuleBuilder` carries
 * `overrideModule`, which replaces the binding module itself and reproduces the deployment
 * fault exactly. `architecture-guardian` found it by reverting the fix and watching all
 * three cases stay green. The same false claim stood in both other port suites and has
 * been corrected in both: `cells-index-port-unbound`, which this sentence named, and
 * `network-change-port-unbound`, which it did not — that one was found by grepping all
 * three suites for `overrideModule`, which is the sweep that naming one copy does not do.*
 *
 * **What refusing buys.** The alternative reading is to skip the port and answer without
 * section 5's administrator exclusion, which would put an administrator's entire disciple
 * set on an attention list nobody can act on — section 20 asks the list to be shown to the
 * upline who can act, and an administrator outside the pastoral structure is in the correct
 * and permanent state rather than waiting for anybody. That is the fail-open hole section 2
 * describes as turning a wiring fault into a silent hole in whatever rule the port answered.
 *
 * Fixture names and email addresses are invented (`CLAUDE.md`, Secrets).
 */

/** Replaces `AdminAccountsBindingModule`, binding nothing, so the token resolves to `undefined`. */
@Module({})
class NoAdminAccountsBinding {}

/** The tree every case below runs against: a root, an unplaced leader, and an administrator. */
interface Fixture {
  admin: TestAccount;
  mark: TestPerson;
}

const buildFixture = async (app: INestApplication, db: Kysely<Database>): Promise<Fixture> => {
  const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
  await assignTo(db, raymond.id, null);

  const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
  await assignTo(db, mark.id, raymond.id);

  const adminPerson = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
  const admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

  return { admin, mark };
};

/** Leaves Juan holding an open row whose leader holds none — the condition the list keys on. */
const breakAnEdge = async (db: Kysely<Database>, mark: TestPerson): Promise<void> => {
  const juan = await createPerson(db, { firstName: 'Juan', lastName: 'Reyes', network: 'MENS' });
  await assignTo(db, juan.id, mark.id);
  await db
    .updateTable('pastoral_assignments')
    .set({ ended_at: new Date('2021-01-01T00:00:00+08:00') })
    .where('person_id', '=', mark.id)
    .where('ended_at', 'is', null)
    .execute();
};

describe('the awaiting-reassignment list with the admin-accounts port unbound (section 2)', () => {
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

  const list = async (app: INestApplication, as: TestAccount): Promise<request.Response> =>
    request(app.getHttpServer())
      .get('/api/v1/people/awaiting-reassignment')
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
        .overrideModule(AdminAccountsBindingModule)
        .useModule(NoAdminAccountsBinding)
        .compile();

      app = moduleRef.createNestApplication();
      configureApp(app);
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('refuses rather than answering without the administrator exclusion', async () => {
      const { admin, mark } = await buildFixture(app, db);
      await breakAnEdge(db, mark);

      const response = await list(app, admin);

      // 500 rather than a 4xx: an unbound provider is a deployment fault and nothing the
      // caller did, and it is fixed by a redeploy after which the same request succeeds.
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');

      // **The log, because the status alone distinguishes nothing.** `INTERNAL_ERROR`
      // carries a fixed body, so a deliberate refusal and a `TypeError` from a missing
      // guard render identically — which is the defect this port actually shipped with.
      expect(logged.join(' ')).toContain('ADMIN_ACCOUNTS_PORT');
    });

    it('refuses on a healthy tree, where no edge is broken at all', async () => {
      // **The empty case is what a naive guard misses.** The service returns early when no
      // edge is broken, so a refusal placed after that return would surface on the day a
      // leader departed rather than on the day of the deployment. Every leader here holds
      // an open assignment, which is the ordinary state of the church.
      const { admin } = await buildFixture(app, db);

      const response = await list(app, admin);

      expect(response.status).toBe(500);
      expect(logged.join(' ')).toContain('ADMIN_ACCOUNTS_PORT');
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
        .overrideProvider(ADMIN_ACCOUNTS_PORT)
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
      // Both states reach one branch deliberately. A check admitting only `undefined` would
      // be untestable by override, and one admitting only `null` is dead in production —
      // which is the pair this case and the block above pin together.
      const { admin, mark } = await buildFixture(app, db);
      await breakAnEdge(db, mark);

      const response = await list(app, admin);

      expect(response.status).toBe(500);
      expect(logged.join(' ')).toContain('ADMIN_ACCOUNTS_PORT');
    });
  });
});
