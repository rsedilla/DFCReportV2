import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { sql } from 'kysely';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  closeCellDirectly,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

/**
 * Step two of the Cell leadership workflow: approval, of both kinds
 * (SKILL.md section 10, *Step two — Admin approves*).
 *
 * The schema's own rules are pinned in `test/database/cells.spec.ts` — the finality
 * trigger, `..._approver_is_not_requester`, the contiguity and Network triggers on
 * `cell_leaderships`, and both partial unique indexes. What is here is the endpoint's
 * half: who may approve, what is revalidated as of approval rather than as of request,
 * and what the two kinds write.
 *
 * **Every rule below was mutated and the mutation run.** Where a rule cannot be
 * falsified, the case says so rather than implying a pin it does not have.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('Cell leadership approval (section 10)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let root: TestPerson;
  let mark: TestPerson;
  let markCell: TestCell;
  let markAccount: TestAccount;
  let juan: TestPerson;
  let ben: TestPerson;
  let benAccount: TestAccount;
  let carlo: TestPerson;
  let carloCell: TestCell;
  let pedro: TestPerson;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);
    admin = await createAccount(app, db, { person: root, roles: ['ADMIN'] });

    // Mark leads a Cell and disciples Juan.
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, root.id);
    markCell = await createCell(db, { leader: mark });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

    juan = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
    await assignTo(db, juan.id, mark.id);

    // Ben is Mark's sibling, with a branch of his own: Carlo leads a Cell under him
    // and Pedro is a second disciple. That branch is what the "moved outside the
    // requester's scope" cases turn on, because Ben can lose it without the Cell
    // changing hands.
    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    await assignTo(db, ben.id, root.id);
    benAccount = await createAccount(app, db, { person: ben, roles: ['LEADER'] });

    carlo = await createPerson(db, { firstName: 'Carlo', network: 'MENS' });
    await assignTo(db, carlo.id, ben.id);
    carloCell = await createCell(db, { leader: carlo });

    pedro = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });
    await assignTo(db, pedro.id, ben.id);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const submit = (actor: TestAccount, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/v1/cells/leadership-requests')
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const approve = (
    actor: TestAccount,
    requestId: string,
    body: Record<string, unknown> = {},
    key = randomUUID(),
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/cells/leadership-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', key)
      .send(body);

  const decline = (actor: TestAccount, requestId: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/cells/leadership-requests/${requestId}/decline`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'TIMING_DEFERRED' });

  const newCellBody = (prospectiveLeaderId: string) => ({
    kind: 'NEW_CELL',
    prospective_leader_id: prospectiveLeaderId,
    category: 'YOUTH',
    day_of_week: 6,
    time_of_day: '18:00',
  });

  const handoverBody = (prospectiveLeaderId: string, cellId: string) => ({
    kind: 'HANDOVER',
    prospective_leader_id: prospectiveLeaderId,
    cell_id: cellId,
  });

  /** Submit as `actor` and return the request id. */
  const pendingNewCell = async (actor: TestAccount, personId: string): Promise<string> => {
    const response = await submit(actor, newCellBody(personId)).expect(201);
    return response.body.id as string;
  };

  const pendingHandover = async (
    actor: TestAccount,
    personId: string,
    cellId: string,
  ): Promise<string> => {
    const response = await submit(actor, handoverBody(personId, cellId)).expect(201);
    return response.body.id as string;
  };

  /**
   * Move a person to a different pastoral leader, the way a reassignment does: close
   * the open row and open the next at one instant.
   *
   * Written here rather than through `PUT /people/{id}/pastoral-leader` because these
   * cases are about what approval revalidates, not about how the move was authorized —
   * and routing them through the endpoint would make each case depend on the actor
   * holding `people.manage_pastoral_assignment` over both ends.
   */
  const reassign = async (personId: string, leaderId: string): Promise<void> => {
    await db.transaction().execute(async (trx) => {
      const at = new Date();

      await trx
        .updateTable('pastoral_assignments')
        .set({ ended_at: at })
        .where('person_id', '=', personId)
        .where('ended_at', 'is', null)
        .execute();

      await trx
        .insertInto('pastoral_assignments')
        .values({ person_id: personId, leader_id: leaderId, started_at: at })
        .execute();
    });
  };

  describe('approving a new Cell', () => {
    it('mints the Cell, its category, its schedule and its leadership at one instant', async () => {
      const requestId = await pendingNewCell(markAccount, juan.id);

      const response = await approve(admin, requestId).expect(200);

      expect(response.body).toMatchObject({
        id: requestId,
        kind: 'NEW_CELL',
        state: 'APPROVED',
        cell_leader_id: juan.id,
        // A new Cell succeeds nobody, which is what distinguishes it from a handover
        // in both the response and the log (section 21).
        outgoing_cell_leader_id: null,
      });
      expect(response.body.cell_id).toMatch(/^CELL-\d{6}$/);

      const cellUuid = response.body.cell_uuid as string;

      const cell = await db
        .selectFrom('cells')
        .select(['id', 'state', 'created_at'])
        .where('id', '=', cellUuid)
        .executeTakeFirstOrThrow();
      expect(cell.state).toBe('ACTIVE');

      const [category, schedule, leadership] = await Promise.all([
        db
          .selectFrom('cell_categories')
          .select(['category', 'started_at'])
          .where('cell_id', '=', cellUuid)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('cell_schedules')
          .select(['day_of_week', 'time_of_day', 'started_at'])
          .where('cell_id', '=', cellUuid)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('cell_leaderships')
          .select(['person_id', 'started_at', 'ended_at'])
          .where('cell_id', '=', cellUuid)
          .executeTakeFirstOrThrow(),
      ]);

      expect(category.category).toBe('YOUTH');
      expect(schedule.day_of_week).toBe(6);
      expect(leadership.person_id).toBe(juan.id);
      expect(leadership.ended_at).toBeNull();

      // **The four rows share one instant, which section 10 requires by name.** The
      // schedule row is legal only by the `created_at` half of migration 0009's
      // schedule trigger — a Cell created part-way through a month — so a second clock
      // read would not merely be untidy, it would abort the creation. Asserted at the
      // column's own precision rather than by `toEqual` on two `Date`s that happen to
      // agree to the millisecond.
      expect(category.started_at.getTime()).toBe(cell.created_at.getTime());
      expect(schedule.started_at.getTime()).toBe(cell.created_at.getTime());
      expect(leadership.started_at.getTime()).toBe(cell.created_at.getTime());
    });

    it('stamps the Cell after its locks, not at transaction start', async () => {
      // **Section 5: an operation "reads its effective instant after the lock, not
      // before it".** The first version took `cells.created_at` from the column's
      // `DEFAULT now()`, which is *transaction start* — before the advisory lock on the
      // prospective leader has been waited for. All four rows carry that instant into
      // `assert_leadership_stays_in_network`, so the trigger would compare a Network as
      // it stood before a change the lock exists to serialize against.
      //
      // **Pinned without staging concurrency**, because `now()` is constant across a
      // transaction while `clock_timestamp()` advances within it. `audit_log.occurred_at`
      // defaults to `now()`, and the entries are written *after* the Cell — so under the
      // defect the two are exactly equal, and under the rule the Cell is strictly later.
      // Reverting `insert-cell.ts` to `DEFAULT VALUES` reddens this. *It reddens the
      // case below too, which said "and nothing else" until that case existed:
      // transaction start precedes the released instant as well.* What the two pin
      // apart is the clock source here and the ordering there.
      const requestId = await pendingNewCell(markAccount, juan.id);
      const response = await approve(admin, requestId).expect(200);

      const cell = await db
        .selectFrom('cells')
        .select('created_at')
        .where('id', '=', response.body.cell_uuid as string)
        .executeTakeFirstOrThrow();

      const entry = await db
        .selectFrom('audit_log')
        .select('occurred_at')
        .where('action', '=', 'cell.created')
        .executeTakeFirstOrThrow();

      expect(cell.created_at.getTime()).toBeGreaterThan(entry.occurred_at.getTime());
    });

    it('takes the prospective leader’s lock before it stamps the Cell', async () => {
      // **The case above pins the clock source; this pins the ordering its title leads
      // with.** They are different properties, and the first review's remedy caught only
      // one: moving `lockPersonsWithin` below `insertCellWithin` leaves the assertion
      // above green, because `clock_timestamp()` is later than transaction start
      // whenever it is read.
      //
      // Here the lock is held externally, so the approval cannot reach its insert until
      // it is released. The Cell's `created_at` is then after the release, which is only
      // true if the stamp follows the lock.
      const requestId = await pendingNewCell(markAccount, juan.id);

      const blocker = new Client({ connectionString: process.env.DATABASE_URL });
      await blocker.connect();

      try {
        await blocker.query('BEGIN');
        // The same key `lockPersonsWithin` computes: the canonical spelling, hashed.
        await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 0))', [
          juan.id,
        ]);

        const pid = Number(
          (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as string,
        );

        // **`.then` is what dispatches it.** A supertest object is lazy: assigning it to
        // a variable sends nothing, so the poll below would find no waiter and report
        // "nothing ever blocked" against a request that had never been made. This
        // repository has fixed that exact defect once before (`19dfe3c`) and this case
        // reproduced it on the first run.
        const pending = approve(admin, requestId).then((response) => response);
        await waitForBlockedBy(pid);

        // Read after the approval is demonstrably stuck, so it precedes any instant the
        // approval can go on to take — **on the assumption that this process and
        // PostgreSQL share a clock**, which is a host clock compared against a database
        // one. True locally and in CI, and unbounded in general: CLAUDE.md carries the
        // multi-instance skew question as open.
        //
        // **`toBeGreaterThanOrEqual` is about resolution, not skew**, and an earlier
        // version of this comment said skew. `>=` differs from `>` by admitting exact
        // equality and nothing else, so it tolerates no skew in either direction; what
        // it admits is a correct run whose two instants land in the same millisecond,
        // `released` being a host `Date` and the driver truncating `timestamptz` to
        // milliseconds.
        const released = new Date();
        await blocker.query('ROLLBACK');

        // `pending` is a promise rather than a supertest `Test` once `.then` has been
        // called, so the status is asserted here rather than chained.
        const response = await pending;
        expect(response.status).toBe(200);

        const cell = await db
          .selectFrom('cells')
          .select('created_at')
          .where('id', '=', response.body.cell_uuid as string)
          .executeTakeFirstOrThrow();

        expect(cell.created_at.getTime()).toBeGreaterThanOrEqual(released.getTime());
      } finally {
        try {
          await blocker.query('ROLLBACK');
        } finally {
          await blocker.end();
        }
      }
    }, 30000);

    it('marks the request APPROVED, names the Cell it minted, and records who decided', async () => {
      const requestId = await pendingNewCell(markAccount, juan.id);
      const response = await approve(admin, requestId).expect(200);

      const row = await db
        .selectFrom('cell_leadership_requests')
        .select(['state', 'decided_by', 'decided_at', 'cell_id'])
        .where('id', '=', requestId)
        .executeTakeFirstOrThrow();

      expect(row.state).toBe('APPROVED');
      expect(row.decided_by).toBe(admin.id);
      // Section 10: "for NEW_CELL, null until approval sets it", which
      // `..._new_cell_names_its_cell_at_approval` requires of an APPROVED row.
      expect(row.cell_id).toBe(response.body.cell_uuid);

      // **`decided_at` is the instant the write took effect, not a second clock read.**
      // Comparing it against the response alone would be true by construction — both
      // read one field — so it is compared against the Cell's own `created_at`, which
      // is the write. Mutating the approval to stamp `new Date()` reddens this and
      // nothing else.
      expect(row.decided_at?.toISOString()).toBe(response.body.decided_at);

      const minted = await db
        .selectFrom('cells')
        .select('created_at')
        .where('id', '=', response.body.cell_uuid as string)
        .executeTakeFirstOrThrow();
      expect(row.decided_at?.getTime()).toBe(minted.created_at.getTime());
    });

    it('writes the approval, the opening and the account-pending entries (section 21)', async () => {
      const requestId = await pendingNewCell(markAccount, juan.id);
      await approve(admin, requestId).expect(200);

      const actions = await db
        .selectFrom('audit_log')
        .select('action')
        .where('actor_id', '=', admin.id)
        .execute();

      expect(actions.map((row) => row.action).sort()).toEqual([
        'cell.created',
        'cell_leadership.account_pending',
        'cell_leadership.opened',
        'cell_leadership_request.approved',
      ]);
    });

    it('targets the Cell on the opening, and carries the leader in `after`', async () => {
      // **Section 21, since the ruling of 2026-08-31.** Nothing pinned the target of
      // any leadership entry before it: the case above asserts four actions and no
      // targets, so `opened` naming the person and `ended` naming the Cell went
      // unobserved through the whole of Stage 3.
      //
      // Section 7 resolves an entry through its target, and resolves a leadership
      // through the Cell — falling back to its last leader once the Cell is closed,
      // which is what keeps a closed Cell's record with whoever led it. A
      // person-targeted entry follows that person's later pastoral reassignment
      // instead.
      const requestId = await pendingNewCell(markAccount, juan.id);
      const response = await approve(admin, requestId).expect(200);

      const entry = await db
        .selectFrom('audit_log')
        .select(['target_type', 'target_id', 'after'])
        .where('action', '=', 'cell_leadership.opened')
        .executeTakeFirstOrThrow();

      expect(entry.target_type).toBe('cell');
      expect(entry.target_id).toBe(response.body.cell_uuid as string);
      // The incoming leader, which section 21 requires and which is what makes the
      // target a free choice rather than the only place the leader appears.
      expect(entry.after).toMatchObject({ cell_leader_id: juan.id });
    });
  });

  describe('approving a handover', () => {
    it('ends the outgoing assignment and opens the incoming one at the identical instant', async () => {
      const requestId = await pendingHandover(markAccount, juan.id, markCell.id);

      const response = await approve(admin, requestId).expect(200);

      expect(response.body).toMatchObject({
        kind: 'HANDOVER',
        state: 'APPROVED',
        cell_id: markCell.cellId,
        cell_uuid: markCell.id,
        cell_leader_id: juan.id,
        outgoing_cell_leader_id: mark.id,
      });

      const rows = await db
        .selectFrom('cell_leaderships')
        .select(['person_id', 'started_at', 'ended_at'])
        .where('cell_id', '=', markCell.id)
        .orderBy('started_at')
        .execute();

      expect(rows).toHaveLength(2);
      const [outgoing, incoming] = rows;

      expect(outgoing.person_id).toBe(mark.id);
      expect(incoming.person_id).toBe(juan.id);
      expect(incoming.ended_at).toBeNull();

      // **The instant is identical, not merely close.** Migration 0009 refuses the
      // pair unless the predecessor's `ended_at` equals this row's `started_at`
      // exactly, and its own comment names the cause of a near miss: "any approval
      // endpoint that reads the clock twice produces this shape by accident". A
      // microsecond of gap would fail the rule *open* — the leader-to-leader Network
      // check is skipped when no predecessor is selected — so this is asserted rather
      // than left to the trigger.
      expect(outgoing.ended_at).not.toBeNull();
      expect(outgoing.ended_at?.getTime()).toBe(incoming.started_at.getTime());

      // And the decision is stamped with that same instant rather than a third clock
      // read, so one approval carries one timestamp across the row, the log and the
      // response.
      expect(new Date(response.body.decided_at as string).getTime()).toBe(
        incoming.started_at.getTime(),
      );
    });

    it('records the change as one entry carrying both leaders (section 21)', async () => {
      const requestId = await pendingHandover(markAccount, juan.id, markCell.id);
      await approve(admin, requestId).expect(200);

      const entry = await db
        .selectFrom('audit_log')
        .select(['target_type', 'target_id', 'before', 'after'])
        .where('action', '=', 'cell_leadership.changed')
        .executeTakeFirstOrThrow();

      // Section 21: "a reader asking who led a Cell before a handover must find it
      // here". One entry rather than an ending beside an opening, because the two
      // writes share an instant and a split log would report two events at one
      // timestamp with nothing pairing them.
      //
      // **And it starts from the Cell**, which is what that sentence's own reader-question
      // names. Asserted here as well as on the opening, so the ruling of 2026-08-31 is
      // pinned as the agreement of the three rather than one entry at a time: this
      // entry already named the Cell and nothing said it had to.
      expect(entry.target_type).toBe('cell');
      expect(entry.target_id).toBe(markCell.id);
      expect(entry.before).toMatchObject({ cell_leader_id: mark.id });
      expect(entry.after).toMatchObject({ cell_leader_id: juan.id });
    });

    it('leaves the Cell its ID, its category history and its members', async () => {
      const requestId = await pendingHandover(markAccount, juan.id, markCell.id);
      await approve(admin, requestId).expect(200);

      // Section 10: "Nothing else about the Cell changes. It keeps its Cell ID, its
      // category history and its schedule history, because none of those is a fact
      // about who leads it."
      const cell = await db
        .selectFrom('cells')
        .select(['cell_id', 'state'])
        .where('id', '=', markCell.id)
        .executeTakeFirstOrThrow();
      expect(cell).toEqual({ cell_id: markCell.cellId, state: 'ACTIVE' });

      const categories = await db
        .selectFrom('cell_categories')
        .select('id')
        .where('cell_id', '=', markCell.id)
        .where('ended_at', 'is', null)
        .execute();
      expect(categories).toHaveLength(1);
    });

    it('writes the account-pending entry even where the incoming leader already leads a Cell', async () => {
      // **The ruling of 2026-08-30, and the case it turns on.** Section 10 requires the
      // entry unconditionally: leading a Cell and holding an account are not the same
      // fact, and conditioning on Cell leadership would suppress it in exactly the
      // state direct creation and every earlier approval produce — a current Cell
      // Leader with the account step still pending.
      //
      // Juan is given a Cell of his own first, so that the handover below hands
      // `markCell` to somebody who is *already* a current Cell Leader. A conditional
      // implementation writes nothing in this state; section 10 requires the entry.
      await createCell(db, { leader: juan });

      const requestId = await pendingHandover(markAccount, juan.id, markCell.id);
      await approve(admin, requestId).expect(200);

      const pending = await db
        .selectFrom('audit_log')
        .select('target_id')
        .where('action', '=', 'cell_leadership.account_pending')
        .execute();

      expect(pending).toEqual([{ target_id: juan.id }]);
    });
  });

  describe('who may approve', () => {
    it('refuses an actor approving a request they submitted', async () => {
      // Section 10 makes this the enforceable control, and says not to rely on the two
      // capabilities never meeting in one actor — Admin holds both by default. The
      // Admin account sits on the root, whose subtree-excluding-self covers Juan, so
      // one account can both submit and try to decide.
      const requestId = await pendingNewCell(admin, juan.id);

      const response = await approve(admin, requestId).expect(403);

      // The *code* rather than merely a failure: without the domain check this reaches
      // `..._approver_is_not_requester` and answers `INTERNAL_ERROR`, which is the
      // 500-instead-of-an-answer failure this repository keeps recording.
      expect(response.body.error.code).toBe('SCOPE_DENIED');

      const row = await db
        .selectFrom('cell_leadership_requests')
        .select('state')
        .where('id', '=', requestId)
        .executeTakeFirstOrThrow();
      expect(row.state).toBe('PENDING');
    });

    it('refuses a Leader, who does not hold cell.approve_leadership', async () => {
      const requestId = await pendingNewCell(markAccount, juan.id);

      const response = await approve(benAccount, requestId).expect(403);
      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    });

    it('refuses a request that was already decided', async () => {
      const requestId = await pendingNewCell(markAccount, juan.id);
      await decline(admin, requestId).expect(200);

      const response = await approve(admin, requestId).expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');

      // A decision is final: the decline stands and no Cell was minted.
      const cells = await db.selectFrom('cells').select('id').execute();
      expect(cells).toHaveLength(2); // Mark's and Carlo's, both from the fixture.
    });
  });

  describe('what approval revalidates', () => {
    it('refuses where the prospective leader has since been archived', async () => {
      const requestId = await pendingNewCell(markAccount, juan.id);

      await db
        .updateTable('person_lifecycle')
        .set({ state: 'ARCHIVED' })
        .where('person_id', '=', juan.id)
        .where('ended_at', 'is', null)
        .execute();

      const response = await approve(admin, requestId).expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');

      // Section 10: reject "creating nothing" — without this, approval opens an active
      // leadership assignment for an archived Person and proceeds to provision their
      // credentials, which is what section 3's archive guard exists to prevent.
      const leaderships = await db
        .selectFrom('cell_leaderships')
        .select('id')
        .where('person_id', '=', juan.id)
        .execute();
      expect(leaderships).toEqual([]);
    });

    it('refuses where the prospective leader has since been absorbed by a merge', async () => {
      const requestId = await pendingNewCell(markAccount, juan.id);

      await db
        .updateTable('persons')
        .set({ merged_into_id: mark.id })
        .where('id', '=', juan.id)
        .execute();

      const response = await approve(admin, requestId).expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('refuses where the person has moved outside the requester’s subtree', async () => {
      const requestId = await pendingNewCell(markAccount, juan.id);

      // Juan moves from Mark to Ben. The approver is Admin at Whole Church and is
      // unaffected; what fails is the *requester's* reach, which is the subject
      // section 10 names.
      await reassign(juan.id, ben.id);

      const response = await approve(admin, requestId).expect(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('refuses a Network change through that same condition, with no condition of its own', async () => {
      // **The ruling of 2026-08-30.** Section 10 named "had their Network changed" as
      // a fourth condition and nothing records the prospective leader's Network at
      // request time, so it had no baseline. It needs none: a Network change forces a
      // pastoral reassignment into the new Network (section 4) and no pastoral edge
      // crosses Networks (section 5), so the moved person leaves the requester's
      // subtree and the condition above fires.
      //
      // This is the case that pins that reasoning rather than the prose asserting it.
      const womensRoot = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
      await assignTo(db, womensRoot.id, null);

      const requestId = await pendingNewCell(markAccount, juan.id);

      await db.transaction().execute(async (trx) => {
        const at = new Date();

        // The atomic pair section 4 requires: the Network row and the pastoral edge
        // move at one instant, or the same-Network trigger refuses both.
        await trx
          .updateTable('network_assignments')
          .set({ ended_at: at })
          .where('person_id', '=', juan.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('network_assignments')
          .values({ person_id: juan.id, network: 'WOMENS', started_at: at })
          .execute();

        await trx
          .updateTable('pastoral_assignments')
          .set({ ended_at: at })
          .where('person_id', '=', juan.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('pastoral_assignments')
          .values({ person_id: juan.id, leader_id: womensRoot.id, started_at: at })
          .execute();
      });

      const response = await approve(admin, requestId).expect(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('refuses a handover where the Cell has since been closed', async () => {
      const requestId = await pendingHandover(markAccount, juan.id, markCell.id);

      await closeCellDirectly(db, markCell.id, { reason: 'LEADER_STEPPED_DOWN' });

      const response = await approve(admin, requestId).expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');

      // **Which refusal, not merely that one happened.** Closing a Cell also ends its
      // leadership, so with the closed-Cell check removed this request falls through
      // to the "no open leadership to hand over" guard — which answers the same 409
      // and the same code. The first version of this case asserted only those two and
      // passed against a mutation that deleted the rule it names; the details are what
      // separate them, since only the closure refusal names the Cell.
      expect(response.body.error.details.cell_id).toBe(markCell.cellId);

      const row = await db
        .selectFrom('cell_leadership_requests')
        .select('state')
        .where('id', '=', requestId)
        .executeTakeFirstOrThrow();
      expect(row.state).toBe('PENDING');
    });

    it('refuses a handover where the Cell has moved outside the requester’s scope', async () => {
      // Ben requests that Carlo's Cell pass to Pedro, both in his branch.
      const requestId = await pendingHandover(benAccount, pedro.id, carloCell.id);

      // Carlo is then reassigned to Mark, carrying his Cell out of Ben's subtree.
      // Section 10: "approving anyway would complete a handover of a Cell they no
      // longer oversee, which is exactly the harm the scope rule was written for."
      await reassign(carlo.id, mark.id);

      const response = await approve(admin, requestId).expect(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('refuses a handover where the two leaders are in different Networks', async () => {
      // **Section 10 names this and nothing exercised it.** The refusal exists so the
      // ordinary case is an answer rather than `assert_leadership_stays_in_network`
      // raising at COMMIT as a raw `check_violation` rendered `INTERNAL_ERROR`.
      //
      // Carlo is the outgoing leader and disciples nobody, so his Network can be
      // corrected at all (section 4 refuses one while a person leads anyone). Nothing
      // stops it stranding the Cell he leads — that is the uncovered path migration
      // 0009 names and Stage 3's last item is about — which is what makes this
      // reachable.
      const womensRoot = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
      await assignTo(db, womensRoot.id, null);

      const requestId = await pendingHandover(benAccount, pedro.id, carloCell.id);

      await db.transaction().execute(async (trx) => {
        const at = new Date();

        await trx
          .updateTable('network_assignments')
          .set({ ended_at: at })
          .where('person_id', '=', carlo.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('network_assignments')
          .values({ person_id: carlo.id, network: 'WOMENS', started_at: at })
          .execute();

        await trx
          .updateTable('pastoral_assignments')
          .set({ ended_at: at })
          .where('person_id', '=', carlo.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('pastoral_assignments')
          .values({ person_id: carlo.id, leader_id: womensRoot.id, started_at: at })
          .execute();
      });

      const response = await approve(admin, requestId).expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      // The details rather than the code alone: the scope refusal below it would also
      // fire for this fixture, and it answers 403 — but a mutation deleting only the
      // Network comparison must not be absorbed by whatever refuses next.
      expect(response.body.error.details.cell_id).toBe(carloCell.cellId);

      const rows = await db
        .selectFrom('cell_leaderships')
        .select('id')
        .where('cell_id', '=', carloCell.id)
        .execute();
      expect(rows).toHaveLength(1);
    });

    it('refuses a handover to the person who now leads the Cell', async () => {
      const requestId = await pendingHandover(markAccount, juan.id, markCell.id);

      // The Cell is handed to Juan by another route in the meantime, so the request
      // would now change nothing. Section 10 refuses it for the reason section 4
      // refuses a sex correction that changes nothing: an audited operation that
      // changed nothing, and a boundary in the history where nothing happened.
      await db.transaction().execute(async (trx) => {
        const at = new Date();
        await trx
          .updateTable('cell_leaderships')
          .set({ ended_at: at })
          .where('cell_id', '=', markCell.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('cell_leaderships')
          .values({ person_id: juan.id, cell_id: markCell.id, started_at: at })
          .execute();
      });

      const response = await approve(admin, requestId).expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });
  });

  describe('the request body and the replay', () => {
    it('refuses a body carrying anything, an effective date most of all', async () => {
      const requestId = await pendingNewCell(markAccount, juan.id);

      // Section 10: "Everything takes effect at approval, never at request. Nothing
      // about a request is backdated to when it was made." An empty DTO plus
      // `forbidNonWhitelisted` is what turns that from a sentence into a refusal — an
      // omitted DTO would drop the field and answer 200 having ignored it.
      const response = await approve(admin, requestId, { effective_date: '2026-01-01' }).expect(
        422,
      );
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('replays the stored answer for a repeated key rather than approving twice', async () => {
      const requestId = await pendingNewCell(markAccount, juan.id);
      const key = randomUUID();

      const first = await approve(admin, requestId, {}, key).expect(200);
      const second = await approve(admin, requestId, {}, key).expect(200);

      expect(second.body).toEqual(first.body);

      // Without the replay the second call meets a request that is no longer PENDING
      // and answers 409 — so this pins the stored completion rather than the
      // finality check.
      const cells = await db.selectFrom('cells').select('id').execute();
      expect(cells).toHaveLength(3); // Mark's, Carlo's, and the one this minted.
    });
  });

  it('refuses a request id that is not a UUID with an answer rather than a database error', async () => {
    // Section 7: a route with a path parameter the guard does not resolve against must
    // validate it itself, or the value reaches a `uuid` comparison and `22P02` is
    // rendered `INTERNAL_ERROR`.
    const response = await request(app.getHttpServer())
      .post('/api/v1/cells/leadership-requests/not-a-uuid/approve')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  describe('the two lock classes a handover takes (section 5)', () => {
    // **Section 5 requires the demonstration, not the assertion**: "an operation needing
    // both classes demonstrates its ordering, its lock strengths and what bounds each
    // wait against concurrent writers, and every clause above is held by a case that
    // fails without it. A clause with nothing that can fail on it is how the third
    // attempt looked right."
    //
    // A handover needs both — advisory locks on the two leaders, then the `cells` row at
    // `FOR SHARE`. The `NEW_CELL` case above exercises neither the Cell lock nor the
    // ordering between the classes, because a new Cell does not exist to be locked.

    it('takes the leaders before the Cell, never the other way round', async () => {
      const requestId = await pendingHandover(markAccount, juan.id, markCell.id);

      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      const prober = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      await prober.connect();

      try {
        const holderPid = Number(
          (await holder.query<{ pid: string }>('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );

        // The outgoing leader. `lockPersonsWithin` sorts by lock key, so holding either
        // of the two stops the approval before it reaches the Cell whichever order the
        // keys happen to fall in.
        await holder.query('BEGIN');
        await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 0))', [
          mark.id,
        ]);

        const approving = approve(admin, requestId).then((response) => response);

        // **A shorter poll here than the helper's default, because this case spends the
        // rest of the approval's 3s bound itself.** The probe below adds a `BEGIN`, a
        // `SET LOCAL`, a bounded `SELECT` and a `ROLLBACK` inside the same wait, so the
        // helper's 2s budget — justified as "deliberately under the service's 3s
        // `lock_timeout`" on the assumption that it is the only thing in that window —
        // no longer leaves room. 1s of poll plus a 1s probe bound keeps the total under
        // the wait on a slow runner.
        await waitForBlockedBy(holderPid, 50);

        // **The Cell row is free, so the approval has not reached it.** Bounded, so a
        // service taking its Cell lock first fails this as a timeout rather than
        // hanging the run.
        await prober.query('BEGIN');
        await prober.query("SET LOCAL lock_timeout = '1s'");
        await prober.query('SELECT id FROM cells WHERE id = $1 FOR NO KEY UPDATE', [markCell.id]);
        await prober.query('ROLLBACK');

        await holder.query('ROLLBACK');

        expect((await approving).status).toBe(200);
      } finally {
        try {
          await holder.query('ROLLBACK');
          await prober.query('ROLLBACK');
        } finally {
          await holder.end();
          await prober.end();
        }
      }
    }, 30000);

    it('takes the Cell at FOR SHARE, which an ordinary add into it does not wait on', async () => {
      // **Section 5's third clause: the lock *strength*.** The two cases either side pin
      // the ordering and the bound and leave this free — `CellLock` offers exactly two
      // values, and swapping `ReadsTheState` for `WritesTheRow` keeps both of them green.
      //
      // **The discriminating holder is `FOR SHARE`, and the review's suggested
      // `FOR KEY SHARE` is not.** PostgreSQL's matrix has `FOR KEY SHARE` compatible
      // with both `FOR SHARE` and `FOR NO KEY UPDATE`, so a `FOR KEY SHARE` holder lets
      // the mutant through exactly as it lets the real thing through. A `FOR SHARE`
      // holder does not: `FOR SHARE` is compatible with itself and conflicts with
      // `FOR NO KEY UPDATE`. So this succeeds only while the operation asks for the
      // weaker of the two.
      //
      // What the strength buys is stated in `cell-lock.ts`: `FOR NO KEY UPDATE` would
      // conflict with the `FOR SHARE` that `assert_cell_memberships_match_state` takes
      // at commit, so an approval in flight would make a concurrent add into the same
      // Cell wait, and possibly time out. That is behaviour, not taste.
      const requestId = await pendingHandover(markAccount, juan.id, markCell.id);

      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM cells WHERE id = $1 FOR SHARE', [markCell.id]);

        let timer: NodeJS.Timeout | undefined;
        const response = await Promise.race([
          approve(admin, requestId),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('The approval was still waiting after 8s.')),
              8000,
            );
          }),
        ]).finally(() => clearTimeout(timer));

        expect(response.status).toBe(200);
      } finally {
        try {
          await holder.query('ROLLBACK');
        } finally {
          await holder.end();
        }
      }
    }, 30000);

    it('takes the Cell row, and gives up on it within the bound', async () => {
      const requestId = await pendingHandover(markAccount, juan.id, markCell.id);

      const blocker = new Client({ connectionString: process.env.DATABASE_URL });
      await blocker.connect();

      try {
        await blocker.query('BEGIN');
        // `FOR NO KEY UPDATE` conflicts with the `FOR SHARE` `CellLock.ReadsTheState`
        // takes, and **not** with the `FOR KEY SHARE` a `cell_leaderships` insert takes
        // through its foreign key. So this blocks the approval only if it genuinely
        // takes the Cell lock: delete `lockCellsWithin` and the approval sails past a
        // held row and answers 200.
        await blocker.query('SELECT id FROM cells WHERE id = $1 FOR NO KEY UPDATE', [markCell.id]);

        let timer: NodeJS.Timeout | undefined;
        const response = await Promise.race([
          approve(admin, requestId),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('The approval was still waiting after 8s: no lock_timeout.')),
              8000,
            );
          }),
        ]).finally(() => clearTimeout(timer));

        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('RESOURCE_BUSY');
      } finally {
        try {
          await blocker.query('ROLLBACK');
        } finally {
          await blocker.end();
        }
      }
    }, 30000);
  });

  it('bounds the wait when declining a request another transaction holds', async () => {
    // **Section 5: an operation that takes row locks and locks no person sets the bound
    // itself**, because `lockPersonsWithin` returns before setting `lock_timeout` when
    // the person list is empty — and `decline`'s always is. Approval is what made this
    // reachable: it now holds the same request row across an entire Cell creation.
    //
    // Deleting `boundLockWaitsWithin` from `decline` leaves this red and nothing else;
    // without it the request waits until the blocker's connection closes.
    const requestId = await pendingNewCell(markAccount, juan.id);

    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();

    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM cell_leadership_requests WHERE id = $1 FOR UPDATE', [
        requestId,
      ]);

      // Raced against a timer, because the failure this pins is a wait that never ends:
      // a bare await would hang the suite until the job timeout rather than failing.
      let timer: NodeJS.Timeout | undefined;
      const response = await Promise.race([
        decline(admin, requestId),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('The decline was still waiting after 8s: no lock_timeout.')),
            8000,
          );
        }),
      ]).finally(() => clearTimeout(timer));

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('RESOURCE_BUSY');
    } finally {
      try {
        await blocker.query('ROLLBACK');
      } finally {
        await blocker.end();
      }
    }
  }, 30000);

  it('answers NOT_FOUND for a request that does not exist', async () => {
    // Safe as an absence rather than a denial: the guard admits only a Whole Church
    // holder of `cell.approve_leadership`, so every caller reaching here would have
    // been covered had the request existed (section 22).
    const response = await approve(admin, randomUUID()).expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

/**
 * Wait until some backend is blocked **by this one**, keyed on the blocker's pid.
 *
 * A bare `pg_stat_activity` predicate was rejected on this repository once already and
 * the reason is recorded: it is cluster-wide, this machine also carries `dfc_dev`, and
 * in CI the test role is a superuser — so "some backend is blocked" matches waits the
 * case knows nothing about and would pass with no lock under test at all. The waiter's
 * own pid is genuinely unknown, being a pooled connection inside the application; the
 * blocker's is not.
 */
async function waitForBlockedBy(blockerPid: number, attempts = 100): Promise<void> {
  const probe = createTestDb();

  try {
    // 20ms a turn, and the default 100 turns is 2s — deliberately under the service's 3s
    // `lock_timeout`, because a wider budget lets a slow-but-correct run time out here
    // and report the same message a genuine regression produces, which is a diagnostic
    // that lies.
    //
    // **The budget is a parameter because that reasoning assumes the poll is the only
    // thing inside the service's wait**, and a caller that goes on to do work of its own
    // in that window has less of it to spend. One does.
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const waiting = await sql<{ count: string }>`
        SELECT count(*) AS count
          FROM pg_stat_activity
         WHERE ${blockerPid}::int = ANY (pg_blocking_pids(pid))
      `.execute(probe);

      if (Number(waiting.rows[0].count) > 0) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Nothing ever blocked on backend ${blockerPid}.`);
  } finally {
    await probe.destroy();
  }
}
