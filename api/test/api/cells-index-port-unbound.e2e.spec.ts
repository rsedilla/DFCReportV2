import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { RECORDED_MEETINGS_PORT } from '../../src/cells/recorded-meetings.port';
import { EMAIL_PORT } from '../../src/email/email.port';
import { CapturingEmailAdapter } from '../setup/capturing-email.adapter';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createCell, createPerson } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

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
 * **What refusing buys.** The alternative reading is to skip the port and publish the
 * denominator alone, which would answer `0 of 5 meetings recorded` for every Cell in the
 * church — a coverage line section 12 makes the evidence that a leader reported nothing,
 * manufactured here by a missing provider. That is the fail-open hole section 2 describes
 * as turning a wiring fault into a silent hole in whatever rule the port was answering.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('the Cells index with the recorded-meetings port unbound (section 2)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let leader: TestAccount;
  let mark: TestPerson;
  /** Everything the exception filter logs at `error` during a case. */
  let logged: string[];
  let loggerSpy: jest.SpyInstance;

  beforeAll(async () => {
    db = createTestDb();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PORT)
      .useClass(CapturingEmailAdapter)
      // The one line under test.
      //
      // **`null` rather than `undefined`.** `useValue(undefined)` reads as the obvious
      // way to say "unbound" and does not override: Nest treats an undefined value as no
      // value and falls through to the real provider, which is how the first version of
      // `network-change-port-unbound.e2e.spec.ts` got a `200` and read as a failed
      // precondition. `null` overrides, and `CellsIndexService` tests the field for
      // falsiness so that both reach the same branch.
      .overrideProvider(RECORDED_MEETINGS_PORT)
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

    const root = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, root.id, null);

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, root.id);
    await createCell(db, { leader: mark, dayOfWeek: 6 });

    leader = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('refuses the listing rather than publishing a coverage line with no numerator', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cells')
      .query({ month: '2026-09-01' })
      .set('Authorization', `Bearer ${leader.accessToken}`);

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

    const response = await request(app.getHttpServer())
      .get('/api/v1/cells')
      .query({ month: '2026-09-01' })
      .set('Authorization', `Bearer ${account.accessToken}`);

    expect(response.status).toBe(500);
    expect(logged.join(' ')).toContain('RECORDED_MEETINGS_PORT');
  });
});
