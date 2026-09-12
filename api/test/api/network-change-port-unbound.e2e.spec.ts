import { randomUUID } from 'node:crypto';

import { Logger, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { CellRelationshipsBindingModule } from '../../src/cells/cell-relationships.binding.module';
import { EMAIL_PORT } from '../../src/email/email.port';
import { CELL_RELATIONSHIPS_PORT } from '../../src/networks/cell-relationships.port';
import { createTestDb, truncateAll } from '../setup/database';
import { CapturingEmailAdapter } from '../setup/capturing-email.adapter';
import { assignTo, createAccount, createPerson, nameSeniorPastors } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * What a Network change does when the Cell-relationships port is not bound
 * (SKILL.md section 4; `networks/cell-relationships.port.ts`).
 *
 * **A suite of its own because no other case can reach this.** Every other test
 * builds the real `AppModule`, which binds the port — so the fail-closed branch is
 * unreachable through `createTestApp`, and a mutation removing it leaves the whole
 * suite green.
 *
 * **Two unbound states, and only one of them is what a deployment produces.** A missing
 * binding module leaves an `@Optional()` token resolving to `undefined`; a provider
 * overridden in a test resolves to `null`, because `useValue(undefined)` does not
 * override at all — Nest reads an undefined value as no value and falls through to the
 * real provider. `NetworksService` therefore tests the field for falsiness in
 * `cellsPortOrThrow`, and **both states are exercised below, in two blocks**.
 *
 * **What the second block buys, stated as the mutation it fails on rather than as a
 * hope.** Removing `@Optional()` from `NetworksService`: section 2 requires an unbound
 * inversion port to cost one operation rather than the whole application, and without
 * that decorator Nest cannot build the application at all when the binding is absent.
 * Run against this suite, that mutation fails the case below and leaves the `null` case
 * green — so the suite as it first stood passed through it entire.
 *
 * *It is deliberately not claimed that the second block catches a `=== null` check, which
 * is the defect `ADMIN_ACCOUNTS_PORT` shipped with. That cannot be written here: `cells`
 * is declared `?:`, so its type holds no `null` and the comparison is a type error. The
 * admin-accounts field is declared `| null`, which is what let the dead check compile
 * there.*
 *
 * *An earlier version of this suite reached `null` only, while its own docblock said it
 * overrode the binding "to `undefined`" — so the file stated the thing it did not do.
 * `TestingModuleBuilder` carries `overrideModule`, which replaces the binding module
 * itself and reproduces the deployment fault exactly. The same omission was corrected on
 * `admin-accounts-port-unbound` first; this suite and `cells-index-port-unbound` carried
 * it unrecorded.*
 *
 * **It is not a hypothetical.** Building this precondition, the port was first bound
 * in `AppModule`'s provider list, which is the wrong context: Nest resolves a
 * provider's dependencies in the module that *registers* it, and `NetworksService` is
 * registered in `NetworksModule`. Fifteen existing sex-correction cases turned red at
 * once — which is what a fail-open reading would have
 * turned into a silent hole in a rule section 4 states absolutely.
 *
 * *An earlier version of this said "with exactly the message below". The message
 * assertion was deleted when the refusal moved to 500, and the message itself was
 * rewritten — so the sentence pointed at nothing.*
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */

/** Replaces `CellRelationshipsBindingModule`, binding nothing, so the token resolves to `undefined`. */
@Module({})
class NoCellRelationshipsBinding {}

/** The two roots, a leader in each Network, and an Admin account on the Men's root. */
interface Fixture {
  admin: TestAccount;
  mark: TestPerson;
  grace: TestPerson;
}

const buildFixture = async (app: INestApplication, db: Kysely<Database>): Promise<Fixture> => {
  const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
  const geraldine = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
  await assignTo(db, oriel.id, null);
  await assignTo(db, geraldine.id, null);

  const mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
  await assignTo(db, mark.id, oriel.id);
  const grace = await createPerson(db, { firstName: 'Grace', network: 'WOMENS' });
  await assignTo(db, grace.id, geraldine.id);

  const admin = await createAccount(app, db, { person: oriel, roles: ['ADMIN'] });
  nameSeniorPastors(app, []);

  return { admin, mark, grace };
};

describe('a Network change with the Cell-relationships port unbound (section 4)', () => {
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

  const correctSex = async (app: INestApplication, fixture: Fixture): Promise<request.Response> =>
    request(app.getHttpServer())
      .put(`/api/v1/people/${fixture.mark.id}/sex`)
      .set('Authorization', `Bearer ${fixture.admin.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: fixture.grace.id,
      });

  /** Refused means nothing written: the Network row must be untouched. */
  const networkOf = async (personId: string): Promise<string> => {
    const row = await db
      .selectFrom('network_assignments')
      .select('network')
      .where('person_id', '=', personId)
      .where('ended_at', 'is', null)
      .executeTakeFirstOrThrow();

    return row.network;
  };

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
        .overrideModule(CellRelationshipsBindingModule)
        .useModule(NoCellRelationshipsBinding)
        .compile();

      app = moduleRef.createNestApplication();
      configureApp(app);
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('refuses the change rather than proceeding unchecked', async () => {
      const fixture = await buildFixture(app, db);

      const response = await correctSex(app, fixture);

      // **500, and the status is the point rather than a detail.** Section 22 stores a
      // 4xx against the idempotency key and releases a 5xx. An unbound port reaches no
      // decision about the record — it is fixed by a redeploy, after which the same
      // request should succeed — so a stored 409 would replay this refusal for the whole
      // retention to a client retrying an unchanged body. The first version asserted 409
      // and pinned the defect.
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');

      // **The log, because the status alone no longer distinguishes anything.** Moving to
      // 500 was right and cost this suite its pin: with the guard replaced by a non-null
      // assertion, `this.cells!.openLeadershipsOf(...)` raises a `TypeError`, which the
      // filter also renders 500 / `INTERNAL_ERROR` — so both assertions above pass against
      // a service that checks nothing. Verified by running that mutation. `INTERNAL_ERROR`
      // carries a fixed body, so nothing in the response can tell a deliberate refusal
      // from a crash; the log can, and it is what an operator diagnoses this from.
      expect(logged.join(' ')).toContain('CELL_RELATIONSHIPS_PORT');

      // **What this pins, exactly.** One substring appearing somewhere in `Logger.error`
      // output during the case — not the level, not the source, and not that the message
      // names the person or calls itself a deployment fault, all of which an operator's
      // diagnosis actually rests on. It is deliberately not narrowed to the filter's own
      // logger, because the spy is on the prototype and every logger in the process
      // shares it. Sufficient for the mutation it exists to catch, and weaker than the
      // sentence "an operator can diagnose this" would suggest on its own.

      // **Refused means nothing written.** The point of failing closed is that a
      // wiring fault cannot let a Network change through unverified, so the Network
      // row must be untouched.
      expect(await networkOf(fixture.mark.id)).toBe('MENS');
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
        .overrideProvider(CELL_RELATIONSHIPS_PORT)
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
      const fixture = await buildFixture(app, db);

      const response = await correctSex(app, fixture);

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(logged.join(' ')).toContain('CELL_RELATIONSHIPS_PORT');
      expect(await networkOf(fixture.mark.id)).toBe('MENS');
    });
  });
});
