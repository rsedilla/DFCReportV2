import { randomUUID } from 'node:crypto';

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
 * Step one of the Cell leadership workflow, and its decline
 * (SKILL.md section 10, *Creating a Cell*; section 19, *Admin dashboard*).
 *
 * The schema's own rules are pinned in `test/database/cells.spec.ts` — the check
 * constraints on what each kind requires, the finality trigger, and both partial unique
 * indexes. What is here is the endpoint's half: who may submit one, the Cell check a
 * handover carries, who may decline, and the queue.
 *
 * **Approval is not here and is not built.** It is the half that writes Cells,
 * leadership assignments and accounts, and it lands as its own slice.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('Cell leadership requests (section 10)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let root: TestPerson;
  let mark: TestPerson;
  let markCell: TestCell;
  let markAccount: TestAccount;
  let juan: TestPerson;
  let ben: TestPerson;
  let benCell: TestCell;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);

    // **The Admin account sits on the root, and that is load-bearing rather than
    // decorative.** Section 7 gives `cell.request_leadership` at subtree-excluding-self
    // to *every* role, Admin included — so an Admin whose Person has no disciples can
    // submit a request for nobody at all. Two cases below need an Admin who can both
    // submit and decide, and putting the account on the root is the smallest fixture
    // that gives one.
    admin = await createAccount(app, db, { person: root, roles: ['ADMIN'] });

    // Mark leads a Cell and disciples Juan. Ben is Mark's sibling under the root, so
    // Ben's Cell is outside Mark's subtree — which is what the scope cases turn on.
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, root.id);
    markCell = await createCell(db, { leader: mark });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

    juan = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
    await assignTo(db, juan.id, mark.id);

    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    await assignTo(db, ben.id, root.id);
    benCell = await createCell(db, { leader: ben });
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

  const decline = (actor: TestAccount, requestId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/v1/cells/leadership-requests/${requestId}/decline`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const queue = (actor: TestAccount, query = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/cells/leadership-requests${query}`)
      .set('Authorization', `Bearer ${actor.accessToken}`);

  const newCell = (prospectiveLeaderId: string) => ({
    kind: 'NEW_CELL',
    prospective_leader_id: prospectiveLeaderId,
    category: 'YOUTH',
    day_of_week: 6,
    time_of_day: '18:00',
  });

  describe('submitting a request', () => {
    it('records a new-Cell request as PENDING, naming nothing else', async () => {
      const response = await submit(markAccount, newCell(juan.id)).expect(201);

      expect(response.body).toMatchObject({
        kind: 'NEW_CELL',
        state: 'PENDING',
        prospective_leader_id: juan.id,
        category: 'YOUTH',
        day_of_week: 6,
      });

      // Section 10: for a new Cell "nothing names it until approval mints it".
      expect(response.body.cell_id).toBeNull();
      expect(response.body.cell_uuid).toBeNull();

      // **A request creates nothing.** Section 10: it "creates no Cell, holds no
      // members, records no attendance, changes no leadership". This is the property
      // that lets the whole slice exist without touching those tables, so it is
      // asserted rather than assumed.
      const cells = await db.selectFrom('cells').select('id').execute();
      expect(cells).toHaveLength(2); // Mark's and Ben's, both from the fixture.

      const leaderships = await db
        .selectFrom('cell_leaderships')
        .select('id')
        .where('person_id', '=', juan.id)
        .execute();
      expect(leaderships).toEqual([]);
    });

    it('refuses a leader naming themselves', async () => {
      // **The one place a scope value does the work of a prohibition** (section 7).
      // `cell.request_leadership` is SUBTREE_EXCL_SELF precisely so that "no holder of
      // the capability, at any scope, may name themselves" needs no domain check — the
      // object the scope resolves against is the one object the actor may not be.
      //
      // Section 10 gives the reason: a leader whose only Cell has closed keeps their
      // account, and without this could restore their own Current Cell Leader status
      // and re-enter New Cell Leaders with no upline involved.
      const response = await submit(markAccount, newCell(mark.id)).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('refuses a leader naming somebody outside their subtree', async () => {
      // Ben is Mark's sibling under the root, so he is outside Mark's subtree.
      const response = await submit(markAccount, newCell(ben.id)).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('refuses a second pending new-Cell request for the same person', async () => {
      // Section 10: two are "indistinguishable downstream: both may be approved, and
      // nothing catches the duplicate, because a leader may legitimately lead many
      // Cells." The partial unique index is the enforcement; this answer exists so the
      // ordinary case is a sentence rather than a `23505` rendered INTERNAL_ERROR.
      await submit(markAccount, newCell(juan.id)).expect(201);

      const response = await submit(markAccount, newCell(juan.id)).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/pending request for a new Cell/);
    });

    it('refuses a cell_id on a new-Cell request rather than ignoring it', async () => {
      // The database says a PENDING NEW_CELL row names no Cell, so a client sending one
      // meant something the workflow cannot do. Refused at the boundary rather than
      // silently dropped.
      const response = await submit(markAccount, {
        ...newCell(juan.id),
        cell_id: markCell.id,
      }).expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('a handover', () => {
    it('lets the Cell’s own leader hand it to their disciple', async () => {
      // **This is the case the capability choice turns on.** The guard resolves
      // `cell.request_leadership` against Juan — in Mark's subtree, and not Mark. The
      // Cell is then checked against `cell.manage_lifecycle`, which section 10 calls
      // "the same terms that govern closing it" and which is OWN_SUBTREE, *including*
      // self.
      //
      // Resolved instead through the capability the guard used — SUBTREE_EXCL_SELF —
      // the Cell's leader is Mark, the actor, and this legitimate handover is refused.
      // That is the commonest handover there is: a leader stepping down and naming
      // their own disciple.
      const response = await submit(markAccount, {
        kind: 'HANDOVER',
        prospective_leader_id: juan.id,
        cell_id: markCell.id,
      }).expect(201);

      expect(response.body).toMatchObject({
        kind: 'HANDOVER',
        state: 'PENDING',
        prospective_leader_id: juan.id,
        cell_id: markCell.cellId,
        cell_uuid: markCell.id,
      });

      // Nothing about the Cell moved: section 10 puts every effect at approval.
      const leadership = await db
        .selectFrom('cell_leaderships')
        .select('person_id')
        .where('cell_id', '=', markCell.id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();

      expect(leadership.person_id).toBe(mark.id);
    });

    it('refuses a Cell outside the requester’s scope', async () => {
      // Ben's Cell is in a branch Mark has nothing to do with. Section 10: "without it
      // an unrelated upline could give away a Cell belonging to a branch they have
      // nothing to do with." Note the guard passes here — Juan is in Mark's subtree —
      // so this reddens only if the domain check exists.
      const response = await submit(markAccount, {
        kind: 'HANDOVER',
        prospective_leader_id: juan.id,
        cell_id: benCell.id,
      }).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.error.details.capability).toBe('cell.manage_lifecycle');
    });

    it('refuses a closed Cell', async () => {
      await closeCellDirectly(db, markCell.id, { reason: 'LEADER_STEPPED_DOWN' });

      const response = await submit(markAccount, {
        kind: 'HANDOVER',
        prospective_leader_id: juan.id,
        cell_id: markCell.id,
      }).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/closed/);
    });

    it('refuses naming the Cell’s current leader', async () => {
      // Section 10: "A handover naming the Cell's current leader is refused." The
      // approval would end and reopen one leadership at a single instant, leaving an
      // audited operation that changed nothing. Admin submits it, because Mark cannot
      // name himself and the guard would refuse that first — this case is about the
      // Cell check rather than about the scope.
      const response = await submit(admin, {
        kind: 'HANDOVER',
        prospective_leader_id: mark.id,
        cell_id: markCell.id,
      }).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/already leads this Cell/);
    });

    it('refuses a second pending handover of the same Cell', async () => {
      // Section 10, and a different rule from the one above it: two handovers of one
      // Cell to two people are "contradictory rather than indistinguishable — both may
      // be approved, and the second silently ends the leadership the first opened."
      await submit(markAccount, {
        kind: 'HANDOVER',
        prospective_leader_id: juan.id,
        cell_id: markCell.id,
      }).expect(201);

      const other = await createPerson(db, { firstName: 'Nestor', network: 'MENS' });
      await assignTo(db, other.id, mark.id);

      const response = await submit(markAccount, {
        kind: 'HANDOVER',
        prospective_leader_id: other.id,
        cell_id: markCell.id,
      }).expect(409);

      expect(response.body.error.message).toMatch(/pending handover request/);
    });

    it('permits a pending new Cell and a pending handover for one person', async () => {
      // **Neither uniqueness rule is widened to cover both kinds** (section 10): these
      // are different questions about different Cells, both legitimate, and widening
      // would make the second unsubmittable rather than declinable.
      //
      // **The handover goes first, and that ordering is the whole of what pins it.**
      // Submitted the other way round, dropping the `kind` filter from the conflict
      // read changes nothing: the new-Cell row carries a null `cell_id`, so the
      // handover's own lookup — keyed on the Cell — does not find it and the pair still
      // succeeds. That mutation was run against the first version of this case and
      // passed. With the handover first, the new-Cell lookup is keyed on the person and
      // finds the pending handover, so a widened rule refuses a request section 10
      // permits.
      await submit(markAccount, {
        kind: 'HANDOVER',
        prospective_leader_id: juan.id,
        cell_id: markCell.id,
      }).expect(201);

      await submit(markAccount, newCell(juan.id)).expect(201);
    });
  });

  describe('declining', () => {
    const pending = async (): Promise<string> => {
      const response = await submit(markAccount, newCell(juan.id)).expect(201);
      return response.body.id as string;
    };

    it('records the decision, the reason and who took it', async () => {
      const id = await pending();

      const response = await decline(admin, id, { reason: 'TIMING_DEFERRED' }).expect(200);

      expect(response.body).toMatchObject({ state: 'DECLINED', reason: 'TIMING_DEFERRED' });

      const row = await db
        .selectFrom('cell_leadership_requests')
        .select(['state', 'decline_reason', 'decided_by', 'decided_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

      expect(row.state).toBe('DECLINED');
      expect(row.decided_by).toBe(admin.id);
      expect(row.decided_at).not.toBeNull();

      // Section 21: "Cell leadership request declined, with the kind and the reason."
      const entry = await db
        .selectFrom('audit_log')
        .select(['action', 'after'])
        .where('action', '=', 'cell_leadership_request.declined')
        .executeTakeFirstOrThrow();

      expect(entry.after).toMatchObject({ kind: 'NEW_CELL', reason: 'TIMING_DEFERRED' });
    });

    it('lets the requester decline their own request', async () => {
      // **The ruling of 2026-08-30, and section 10 now states it.** The prohibition is
      // on *approving* one you submitted, and its reason does not carry: the requester
      // benefits from an approval and from a decline not at all.
      //
      // Admin submits and Admin declines, which is the case that decides it — on a
      // single-Admin deployment the strict reading leaves such a request approvable by
      // nobody and declinable by nobody, PENDING for ever, with the per-leader index
      // then blocking every future request for that person.
      const submitted = await submit(admin, newCell(juan.id)).expect(201);

      await decline(admin, submitted.body.id as string, {
        reason: 'SUBMITTED_IN_ERROR',
      }).expect(200);
    });

    it('refuses a request that was already decided', async () => {
      // **A decision is final** (section 10). The finality trigger refuses it too; this
      // answer exists so the caller gets a sentence rather than a `restrict_violation`
      // nothing classifies.
      const id = await pending();
      await decline(admin, id, { reason: 'TIMING_DEFERRED' }).expect(200);

      const response = await decline(admin, id, { reason: 'DUPLICATE_REQUEST' }).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/already decided/);
    });

    it('refuses OTHER with a whitespace note, not only an absent one', async () => {
      // The constraint compares `btrim(coalesce(note, '')) <> ''`, so `@MinLength(1)`
      // alone accepts two spaces and turns a documented refusal into a constraint
      // violation rendered INTERNAL_ERROR. That is the half-closed fix the closure DTO
      // had to correct, and it is why the transform trims before the validator runs.
      const id = await pending();

      const response = await decline(admin, id, { reason: 'OTHER', note: '   ' }).expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a decline from a leader, who may not decide requests', async () => {
      const id = await pending();

      const response = await decline(markAccount, id, { reason: 'TIMING_DEFERRED' }).expect(403);

      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    });

    it('refuses a request_id that is not a UUID, rather than answering 500', async () => {
      // Section 7: a route with a path parameter the guard does not resolve against
      // must validate it itself, or a non-UUID reaches a `uuid` comparison as a
      // database error.
      const response = await decline(admin, 'not-a-uuid', { reason: 'TIMING_DEFERRED' }).expect(
        422,
      );

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('the Admin queue', () => {
    it('lists pending requests of both kinds, oldest first', async () => {
      const first = await submit(markAccount, newCell(juan.id)).expect(201);
      const second = await submit(markAccount, {
        kind: 'HANDOVER',
        prospective_leader_id: juan.id,
        cell_id: markCell.id,
      }).expect(201);

      const response = await queue(admin).expect(200);

      expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([
        first.body.id,
        second.body.id,
      ]);
      expect(response.body.next_cursor).toBeNull();
    });

    it('drops a request once it is decided', async () => {
      const submitted = await submit(markAccount, newCell(juan.id)).expect(201);
      await decline(admin, submitted.body.id as string, { reason: 'TIMING_DEFERRED' }).expect(200);

      const response = await queue(admin).expect(200);

      expect(response.body.data).toEqual([]);
    });

    it('pages, and the cursor is opaque', async () => {
      const first = await submit(markAccount, newCell(juan.id)).expect(201);
      const second = await submit(markAccount, {
        kind: 'HANDOVER',
        prospective_leader_id: juan.id,
        cell_id: markCell.id,
      }).expect(201);

      const page1 = await queue(admin, '?limit=1').expect(200);
      expect(page1.body.data).toHaveLength(1);
      expect(page1.body.data[0].id).toBe(first.body.id);
      expect(page1.body.next_cursor).not.toBeNull();

      // Section 22: the cursor is opaque and a client never constructs one. A bare
      // identifier would be constructible, which is what that rule forbids.
      expect(page1.body.next_cursor).not.toContain(first.body.id);

      const page2 = await queue(
        admin,
        `?limit=1&cursor=${encodeURIComponent(page1.body.next_cursor as string)}`,
      ).expect(200);

      expect(page2.body.data).toHaveLength(1);
      expect(page2.body.data[0].id).toBe(second.body.id);
      expect(page2.body.next_cursor).toBeNull();
    });

    it('treats an unreadable cursor as absent', async () => {
      // Matching `GET /api/v1/people` and the Cell roster, which is the only behaviour
      // this repository has chosen. Section 22 does not settle it; CLAUDE.md carries
      // that as open.
      await submit(markAccount, newCell(juan.id)).expect(201);

      const response = await queue(admin, '?cursor=not-a-real-cursor').expect(200);

      expect(response.body.data).toHaveLength(1);
    });

    it('is refused to a leader', async () => {
      // `cell.approve_leadership` is Admin's alone (section 7): whoever may decide a
      // request may see the queue of them, and nobody else.
      const response = await queue(markAccount).expect(403);

      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    });
  });
});
