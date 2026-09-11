import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
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
 * application, so nothing else can reach it." `ADMIN_ACCOUNTS_PORT` shipped with the
 * module-graph half and without this one, which `architecture-guardian` found.
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
describe('the awaiting-reassignment list with the admin-accounts port unbound (section 2)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let admin: TestAccount;
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
      // **`null` rather than `undefined`.** `useValue(undefined)` reads as the obvious way
      // to say "unbound" and does not override: Nest treats an undefined value as no value
      // and falls through to the real provider. `null` overrides — and a deployment with
      // the binding module missing produces `undefined`, not `null`, so the service tests
      // the field for falsiness and both reach the same branch. The first version of this
      // port checked `=== null` and was therefore dead on the only fault that produces one.
      .overrideProvider(ADMIN_ACCOUNTS_PORT)
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

    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, raymond.id, null);

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, raymond.id);

    const adminPerson = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const list = async (as: TestAccount): Promise<request.Response> =>
    request(app.getHttpServer())
      .get('/api/v1/people/awaiting-reassignment')
      .set('Authorization', `Bearer ${as.accessToken}`);

  it('refuses the listing rather than answering without the administrator exclusion', async () => {
    // A broken edge, so the list would otherwise have a row to answer with: Juan's leader
    // Mark holds no open assignment of his own.
    const juan = await createPerson(db, { firstName: 'Juan', lastName: 'Reyes', network: 'MENS' });
    await assignTo(db, juan.id, mark.id);
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: new Date('2021-01-01T00:00:00+08:00') })
      .where('person_id', '=', mark.id)
      .where('ended_at', 'is', null)
      .execute();

    const response = await list(admin);

    // 500 rather than a 4xx: an unbound provider is a deployment fault and nothing the
    // caller did, and it is fixed by a redeploy after which the same request succeeds.
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');

    // **The log, because the status alone distinguishes nothing.** `INTERNAL_ERROR` carries
    // a fixed body, so a deliberate refusal and a `TypeError` from a missing guard render
    // identically — which is the mutation this assertion exists to catch, and which is the
    // defect the first version of this port actually had.
    expect(logged.join(' ')).toContain('ADMIN_ACCOUNTS_PORT');
  });

  it('refuses on a healthy tree, where no edge is broken at all', async () => {
    // **The empty case is the one a naive guard misses**, and here it is two guards deep:
    // the service returns early both for a scope reaching nobody and for a tree with no
    // broken edges, so a refusal placed after either would surface on the day a leader
    // departs rather than on the day of the deployment. Every leader in this case holds an
    // open assignment, which is the ordinary state of the church.
    const response = await list(admin);

    expect(response.status).toBe(500);
    expect(logged.join(' ')).toContain('ADMIN_ACCOUNTS_PORT');
  });

  it('refuses for an actor whose scope reaches nobody', async () => {
    // The other early return: a `PERSONS` scope of size zero. A wiring fault that hid
    // behind an empty scope would surface for some leaders and not others, which is worse
    // than surfacing for none.
    const stranger = await createPerson(db, { firstName: 'Ruth', network: 'WOMENS' });
    await assignTo(db, stranger.id, null);
    const account = await createAccount(app, db, { person: stranger, roles: ['LEADER'] });

    const response = await list(account);

    expect(response.status).toBe(500);
    expect(logged.join(' ')).toContain('ADMIN_ACCOUNTS_PORT');
  });
});
