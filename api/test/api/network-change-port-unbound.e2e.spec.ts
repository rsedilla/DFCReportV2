import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
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
 * suite green. This overrides the binding to `undefined` and asserts the refusal.
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
 */
describe('a Network change with the Cell-relationships port unbound (section 4)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let admin: TestAccount;
  /** Everything the exception filter logs at `error` during a case. */
  let logged: string[];
  let loggerSpy: jest.SpyInstance;
  let mark: TestPerson;
  let grace: TestPerson;

  beforeAll(async () => {
    db = createTestDb();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PORT)
      .useClass(CapturingEmailAdapter)
      // The one line under test.
      //
      // **`null` rather than `undefined`, and that is not interchangeable here.**
      // `useValue(undefined)` reads as the obvious way to say "unbound" and does not
      // work: Nest treats an undefined value as no value and falls through to the real
      // provider, so the first version of this case got a 200 and looked like the
      // precondition had failed. `null` overrides, and the service's `if (!this.cells)`
      // treats both alike — so this exercises the same branch an unbound port reaches.
      .overrideProvider(CELL_RELATIONSHIPS_PORT)
      .useValue(null)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(async () => {
    await truncateAll(db);

    logged = [];
    loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => String(arg)).join(' '));
    });

    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const geraldine = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
    await assignTo(db, oriel.id, null);
    await assignTo(db, geraldine.id, null);

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, oriel.id);
    grace = await createPerson(db, { firstName: 'Grace', network: 'WOMENS' });
    await assignTo(db, grace.id, geraldine.id);

    admin = await createAccount(app, db, { person: oriel, roles: ['ADMIN'] });
    nameSeniorPastors(app, []);
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('refuses the change rather than proceeding unchecked', async () => {
    const response = await request(app.getHttpServer())
      .put(`/api/v1/people/${mark.id}/sex`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      });

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

    // **Refused means nothing written.** The point of failing closed is that a
    // wiring fault cannot let a Network change through unverified, so the Network
    // row must be untouched.
    const network = await db
      .selectFrom('network_assignments')
      .select('network')
      .where('person_id', '=', mark.id)
      .where('ended_at', 'is', null)
      .executeTakeFirstOrThrow();

    expect(network.network).toBe('MENS');
  });
});
