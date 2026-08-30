import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * `POST /api/v1/cells` — direct creation during initial encoding (SKILL.md
 * section 2, Initial data load; section 10).
 *
 * This is the one Cell-creation path the encoding phase relaxes. Everything the
 * database refuses about the rows it writes is pinned in
 * `test/database/cells.spec.ts`; what is here is the half that is the endpoint's:
 * the two capabilities section 2 names, the phase boundary, the refusals about the
 * prospective leader, and that the four rows section 10 requires are actually
 * written together.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('cells: direct creation during initial encoding (sections 2 and 10)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let mark: TestPerson;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);

    const adminPerson = await createPerson(db, { firstName: 'Admina', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, root.id);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const body = (cellLeaderId: string) => ({
    cell_leader_id: cellLeaderId,
    category: 'YOUTH',
    day_of_week: 6,
    time_of_day: '19:00',
  });

  const grantWholeChurch = (accountId: string, capability: string) =>
    db
      .insertInto('capability_grants')
      .values({
        account_id: accountId,
        capability,
        scope_type: 'WHOLE_CHURCH',
        scope_network: null,
        read_only: false,
        reason: 'Invented for this case (CLAUDE.md, Secrets).',
        granted_by: admin.id,
      })
      .execute();

  const post = (actor: TestAccount, payload: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/v1/cells')
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(payload);

  it('creates the Cell, its category, its schedule and its leadership together', async () => {
    // Section 10: the four rows open in one transaction, and "the category and
    // schedule rows are not optional extras" — a Cell without a schedule row has no
    // derivable set of scheduled meetings and no coverage figure for its first
    // month.
    const response = await post(admin, body(mark.id)).expect(201);

    expect(response.body).toMatchObject({
      cell_id: expect.stringMatching(/^CELL-[0-9]{6,}$/) as unknown,
      state: 'ACTIVE',
      cell_leader_id: mark.id,
      category: 'YOUTH',
      day_of_week: 6,
    });

    const cellId = response.body.id as string;

    const rows = await sql<{ category: string; day_of_week: number; person_id: string }>`
      SELECT cc.category, cs.day_of_week, cl.person_id
        FROM cells c
        JOIN cell_categories cc ON cc.cell_id = c.id AND cc.ended_at IS NULL
        JOIN cell_schedules cs ON cs.cell_id = c.id AND cs.ended_at IS NULL
        JOIN cell_leaderships cl ON cl.cell_id = c.id AND cl.ended_at IS NULL
       WHERE c.id = ${cellId}
    `.execute(db);

    expect(rows.rows).toEqual([{ category: 'YOUTH', day_of_week: 6, person_id: mark.id }]);
  });

  it('starts the schedule row at the Cell own created_at, to the microsecond', async () => {
    // Section 10 requires the two to be written from one expression, because
    // equality with a column on another table is exact: an application-computed
    // timestamp beside a `DEFAULT now()` differs by microseconds and aborts every
    // creation. A passing 201 alone does not show that — the row could have been
    // written at a month boundary instead — so the instants are compared.
    const response = await post(admin, body(mark.id)).expect(201);

    const match = await sql<{ same: boolean }>`
      SELECT (cs.started_at = c.created_at) AS same
        FROM cells c JOIN cell_schedules cs ON cs.cell_id = c.id
       WHERE c.id = ${response.body.id as string}
    `.execute(db);

    expect(match.rows[0].same).toBe(true);
  });

  it('writes an audit entry for the Cell and one for the leadership, both naming the Cell', async () => {
    // Section 21's convention, and two entries rather than one: a reader searching
    // for who began leading a Cell must find that entry whatever created it.
    //
    // **`cell_leadership.opened` names the Cell**, since the ruling of 2026-08-31, and
    // this case asserted `person` until then. Section 7 resolves an audit entry's scope
    // through its target and resolves a leadership through the Cell's leader as of the
    // period, falling back to its last leader once the Cell is closed — so a
    // person-targeted entry would be read by a different rule from the `ended` and
    // `changed` entries beside it, and only the Cell's rule keeps a closed Cell's
    // record with whoever led it.
    //
    // The leader is still asserted, from `after` rather than from the target, which is
    // where section 21 requires the incoming leader to be. That is what makes the
    // target a free choice: moving it costs a person-shaped search a predicate, not the
    // entry.
    const response = await post(admin, body(mark.id)).expect(201);

    const entries = await db
      .selectFrom('audit_log')
      .select(['action', 'target_type', 'target_id', 'after'])
      .where('action', 'in', ['cell.created', 'cell_leadership.opened'])
      .orderBy('action')
      .execute();

    expect(entries).toEqual([
      {
        action: 'cell.created',
        target_type: 'cell',
        target_id: response.body.id as string,
        after: expect.anything() as unknown,
      },
      {
        action: 'cell_leadership.opened',
        target_type: 'cell',
        target_id: response.body.id as string,
        after: expect.objectContaining({ cell_leader_id: mark.id }) as unknown,
      },
    ]);
  });

  it('records the actor on the category and schedule rows', async () => {
    // Section 10 gives both shapes an `actor_id`, unmarked — and the 2026-08-20
    // ruling on `capability_grants` settled that an unmarked column in one of these
    // shapes means required. Migration 0009's header says the same: null there is
    // for a system action, and this is not one.
    const response = await post(admin, body(mark.id)).expect(201);

    const rows = await sql<{ category_actor: string | null; schedule_actor: string | null }>`
      SELECT cc.actor_id AS category_actor, cs.actor_id AS schedule_actor
        FROM cells c
        JOIN cell_categories cc ON cc.cell_id = c.id
        JOIN cell_schedules cs ON cs.cell_id = c.id
       WHERE c.id = ${response.body.id as string}
    `.execute(db);

    expect(rows.rows).toEqual([{ category_actor: admin.id, schedule_actor: admin.id }]);
  });

  it('records that the leadership is left with account provisioning pending', async () => {
    // Section 21 lists it as an action in its own right, and this path always
    // produces that state: it writes no account and sends no email, because section
    // 7 makes the account a separately authorized step.
    //
    // **This one still names the person, and deliberately.** The 2026-08-31 ruling
    // moved the three actions section 21 groups as "Cell leadership opened, ended, or
    // changed" onto the Cell. This is a fourth action and it is about somebody's
    // *account* — the thing left pending is a provisioning step on a Person (section
    // 6), so the target is the Person whose account it is.
    await post(admin, body(mark.id)).expect(201);

    const entry = await db
      .selectFrom('audit_log')
      .select(['target_type', 'target_id'])
      .where('action', '=', 'cell_leadership.account_pending')
      .executeTakeFirst();

    expect(entry).toEqual({ target_type: 'person', target_id: mark.id });
  });

  it('lets one leader hold a second Cell', async () => {
    // Section 10 says in terms never to assume one Cell Leader means one Cell.
    await post(admin, body(mark.id)).expect(201);
    await post(admin, { ...body(mark.id), category: 'YOUNG_PRO' }).expect(201);

    const led = await db
      .selectFrom('cell_leaderships')
      .select('id')
      .where('person_id', '=', mark.id)
      .where('ended_at', 'is', null)
      .execute();

    expect(led).toHaveLength(2);
  });

  it('refuses once initial encoding is closed', async () => {
    // Section 2: "Once closed, that path is gone and every new Cell goes through
    // request-and-approve." A rule about what may be recorded, whoever submits it,
    // which is what separates INVARIANT_VIOLATION from SCOPE_DENIED (section 22).
    await sql`UPDATE settings SET value = 'false'::jsonb WHERE key = 'initial_encoding_open'`.execute(
      db,
    );

    const response = await post(admin, body(mark.id)).expect(409);

    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    expect(response.body.error.message).toMatch(/request-and-approve/);
  });

  it('refuses an archived prospective leader', async () => {
    const archived = await createPerson(db, {
      firstName: 'Rico',
      network: 'MENS',
      archived: true,
    });

    const response = await post(admin, body(archived.id)).expect(409);

    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    expect(response.body.error.message).toMatch(/archived/);
  });

  it('refuses a Person absorbed by a merge', async () => {
    const survivor = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });
    const absorbed = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });
    await db
      .updateTable('persons')
      .set({ merged_into_id: survivor.id })
      .where('id', '=', absorbed.id)
      .execute();

    const response = await post(admin, body(absorbed.id)).expect(409);

    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    expect(response.body.error.message).toMatch(/merge/);
  });

  it('refuses a Leader, who holds neither capability this path needs', async () => {
    // `cell.approve_leadership` is Admin's alone (section 7), so the guard refuses
    // before the service is reached.
    const leaderAccount = await createAccount(app, db, {
      person: mark,
      roles: ['LEADER'],
      grantedBy: admin.id,
    });

    const response = await post(leaderAccount, body(mark.id)).expect(403);

    expect(response.body.error.code).toBe('CAPABILITY_DENIED');
  });

  it('refuses a Senior Pastor, who holds every other Cell capability', async () => {
    // Section 7 gives a Senior Pastor `cell.manage_leadership` at Whole Church and
    // withholds `cell.approve_leadership` deliberately — approving a Cell mints a
    // Cell Leader and provisions their credentials, which is Admin's. This is the
    // account that holds every other Cell capability and still cannot take this
    // path.
    //
    // **`nameSeniorPastors` is what makes that true of what runs**, and an earlier
    // version of this case omitted it. Section 7 honours a `SENIOR_PASTOR` row only
    // for the two Persons configuration names, so without it the account held no
    // capabilities at all and was refused for a reason having nothing to do with
    // this endpoint.
    //
    // **What it pins is that a Senior Pastor is refused, not which capability the
    // guard declares** — an earlier comment claimed the second and it was never
    // true. With the Admin role check in place a Senior Pastor is refused by role
    // whichever capability the guard names, so mutating the guard leaves this case
    // green. The guard's choice is pinned by `refuses a Leader` above, which
    // reddens against it.
    const pastor = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
    const account = await createAccount(app, db, {
      person: pastor,
      roles: ['SENIOR_PASTOR'],
      grantedBy: admin.id,
      seniorPastorSlot: 1,
    });
    nameSeniorPastors(app, [pastor.id]);

    const response = await post(account, body(mark.id)).expect(403);

    expect(response.body.error.code).toBe('CAPABILITY_DENIED');
  });

  it('refuses an approver holding cell.manage_leadership only over their own subtree', async () => {
    // **The live authorization gap this replaces a weaker case for.** The domain
    // check resolved `cell.manage_leadership` against the prospective leader, and
    // that capability is not Whole-Church-only: every role default carries it, and
    // `LEADER` carries it at `OWN_SUBTREE` **including the actor themselves**. So a
    // Leader holding an Admin-issued Whole Church grant of `cell.approve_leadership`
    // — which section 7 permits explicitly — passed the guard and then satisfied a
    // subtree check against their own disciple.
    //
    // That is section 10's own sentence: "`cell.manage_leadership` at own/subtree
    // scope would let a leader hand a Cell to their own disciple with nobody else
    // involved — the outcome the creation workflow exists to prevent, reached by the
    // one route it did not cover."
    //
    // The earlier case pointed such an actor at somebody **outside** their subtree,
    // which is the half that was already refused. This points them **inside** it,
    // which is the half that was not.
    const disciple = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    const account = await createAccount(app, db, {
      person: mark,
      roles: ['LEADER'],
      grantedBy: admin.id,
    });
    await assignTo(db, disciple.id, mark.id);
    await grantWholeChurch(account.id, 'cell.approve_leadership');

    const response = await post(account, body(disciple.id)).expect(403);

    expect(response.body.error.code).toBe('SCOPE_DENIED');
    expect(await db.selectFrom('cells').select('id').execute()).toHaveLength(0);
  });

  it('refuses an approver naming themselves', async () => {
    // Section 10: "No holder of the capability, at any scope, may name themselves."
    // `OWN_SUBTREE` includes the actor, so the subtree check the previous version
    // made was satisfied by exactly the person section 10 forbids — restoring their
    // own Current Cell Leader status and their upline's Leaders-with-12+ count with
    // no second party involved.
    const account = await createAccount(app, db, {
      person: mark,
      roles: ['LEADER'],
      grantedBy: admin.id,
    });
    await grantWholeChurch(account.id, 'cell.approve_leadership');

    const response = await post(account, body(mark.id)).expect(403);

    expect(response.body.error.code).toBe('SCOPE_DENIED');
    expect(await db.selectFrom('cells').select('id').execute()).toHaveLength(0);
  });

  it('refuses an approver who holds both capabilities at Whole Church but is not Admin', async () => {
    // Section 2 and section 10 give this path to **Admin**, and section 2 settles
    // one paragraph away — for the tree import — that "the role is required, and the
    // capabilities alone are not enough… an implementer following the stated
    // condition accepts a `LEADER` account holding both at Whole Church, which
    // Section 7 lets Admin grant". This is that account.
    const account = await createAccount(app, db, {
      person: mark,
      roles: ['LEADER'],
      grantedBy: admin.id,
    });
    await grantWholeChurch(account.id, 'cell.approve_leadership');
    await grantWholeChurch(account.id, 'cell.manage_leadership');

    const target = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    const response = await post(account, body(target.id)).expect(403);

    expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    expect(response.body.error.details.required_role).toBe('ADMIN');
    expect(await db.selectFrom('cells').select('id').execute()).toHaveLength(0);
  });

  it('replays the first answer for a repeated Idempotency-Key', async () => {
    // Section 22, and the write-endpoint contract in CLAUDE.md: what is recorded is
    // the response the endpoint returns, so a replay reproduces it rather than
    // creating a second Cell.
    const key = randomUUID();
    const send = () =>
      request(app.getHttpServer())
        .post('/api/v1/cells')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', key)
        .send(body(mark.id));

    const first = await send().expect(201);
    const second = await send().expect(201);

    expect(second.body).toEqual(first.body);

    const cells = await db.selectFrom('cells').select('id').execute();
    expect(cells).toHaveLength(1);
  });

  it('refuses a day number outside the ISO range before reaching the database', async () => {
    const response = await post(admin, { ...body(mark.id), day_of_week: 0 }).expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});
