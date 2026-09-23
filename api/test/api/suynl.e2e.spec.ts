import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import request from 'supertest';

import { manilaDayOf } from '../../src/common/time/manila';
import { databaseNow } from '../../src/common/time/submission-window';
import { countWhileInFlight, track } from '../setup/concurrency';
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
 * SUYNL lessons at the API (SKILL.md section 28; decisions 0278 to 0282).
 *
 * Fixture names are invented (CLAUDE.md, Secrets). The tree is the example one:
 *
 *   Raymond (Men's root) -> Manuel -> { Mark -> { Timothy, Silas (archived) }, Nathan }
 *   Grace (Women's root) -> Hannah
 *   Adele: an administrator outside the pastoral tree
 */
describe('SUYNL (section 28)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let timothy: TestPerson;
  let silas: TestPerson;
  let nathan: TestPerson;
  let grace: TestPerson;
  let hannah: TestPerson;

  let admin: TestAccount;
  let raymondAccount: TestAccount;
  let manuelAccount: TestAccount;
  let markAccount: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, raymond.id, null);
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);
    timothy = await createPerson(db, { firstName: 'Timothy', network: 'MENS' });
    await assignTo(db, timothy.id, mark.id);
    silas = await createPerson(db, { firstName: 'Silas', network: 'MENS', archived: true });
    await assignTo(db, silas.id, mark.id);
    nathan = await createPerson(db, { firstName: 'Nathan', network: 'MENS' });
    await assignTo(db, nathan.id, manuel.id);

    grace = await createPerson(db, { firstName: 'Grace', network: 'WOMENS' });
    await assignTo(db, grace.id, null);
    hannah = await createPerson(db, { firstName: 'Hannah', network: 'WOMENS' });
    await assignTo(db, hannah.id, grace.id);

    const adele = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adele, roles: ['ADMIN'] });

    raymondAccount = await createAccount(app, db, {
      person: raymond,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });
    nameSeniorPastors(app, [raymond.id]);

    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  interface Change {
    person_id: string;
    lesson: number;
    done: boolean;
    seen_id?: string | null;
    reason?: string;
  }

  const submit = (account: TestAccount, changes: Change[], key: string = randomUUID()) =>
    request(app.getHttpServer())
      .post('/api/v1/suynl/submit')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', key)
      .send({ changes });

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/suynl/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const tick = (personId: string, lesson: number): Change => ({
    person_id: personId,
    lesson,
    done: true,
  });

  const allRows = () => db.selectFrom('suynl_lessons').selectAll().orderBy('id').execute();

  const currentRows = (personId: string) =>
    db
      .selectFrom('suynl_lessons')
      .selectAll()
      .where('person_id', '=', personId)
      .where('superseded_at', 'is', null)
      .orderBy('lesson')
      .execute();

  const currentRow = async (personId: string, lesson: number) =>
    db
      .selectFrom('suynl_lessons')
      .selectAll()
      .where('person_id', '=', personId)
      .where('lesson', '=', lesson)
      .where('superseded_at', 'is', null)
      .executeTakeFirstOrThrow();

  const auditOf = (action: string) =>
    db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', action as never)
      .orderBy('occurred_at')
      .execute();

  const allAudit = () => db.selectFrom('audit_log').selectAll().execute();

  /**
   * Moves a person under another leader by closing and opening the rows directly, both
   * ends from one host `Date` (fixtures.ts, *Never take the two ends ... from different
   * clocks*), as `reports-by-leader.e2e.spec.ts` does.
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

  /** Seed lessons directly, bypassing the API, as current rows filed by `admin`. */
  const seedLessons = async (personId: string, lessons: number[], confirmedBy: string | null) => {
    for (const lesson of lessons) {
      await db
        .insertInto('suynl_lessons')
        .values({ person_id: personId, lesson, confirmed_by: confirmedBy, recorded_by: admin.id })
        .execute();
    }
  };

  /** Every page of a list, following `next_cursor`. */
  const allPages = async (account: TestAccount, query: string) => {
    const rows: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const response = await get(account, `people?${query}${suffix}`);
      expect(response.status).toBe(200);
      rows.push(...response.body.data);
      cursor = response.body.next_cursor;
      pages += 1;
      expect(pages).toBeLessThan(50);
    } while (cursor !== null);

    return rows;
  };

  const idsOf = (rows: Array<Record<string, unknown>>) => rows.map((row) => row.person_id);

  // ---------------------------------------------------------------------------
  // 1-2. Filing, and who the row names
  // ---------------------------------------------------------------------------

  describe('filing', () => {
    it('records a leader filing for a direct disciple as their own statement', async () => {
      const response = await submit(markAccount, [tick(timothy.id, 1), tick(timothy.id, 2)]);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ created: 2, corrected: 0, unchanged: 0 });

      const rows = await currentRows(timothy.id);
      expect(rows.map((row) => row.lesson)).toEqual([1, 2]);
      for (const row of rows) {
        expect(row.confirmed_by).toBe(mark.id);
        expect(row.recorded_by).toBe(markAccount.id);
      }

      const entries = await auditOf('suynl_lesson.confirmed');
      expect(entries).toHaveLength(2);
      for (const entry of entries) {
        expect(entry.actor_id).toBe(markAccount.id);
        expect(entry.target_type).toBe('person');
        expect(entry.target_id).toBe(timothy.id);
        expect(entry.after).toMatchObject({ confirmed_by: mark.id, on_behalf: false });
      }

      // The day the tick carries is the Manila date of `confirmed_at` (section 28).
      const byLesson = new Map(rows.map((row) => [row.lesson, row]));
      for (const entry of entries) {
        const lesson = (entry.after as { lesson: number }).lesson;
        const row = byLesson.get(lesson);
        expect(row).toBeDefined();
        expect((entry.after as { filed_on?: string }).filed_on).toBe(
          manilaDayOf(row!.confirmed_at),
        );
      }
    });

    it("records an upline filing for a downline leader's disciple as on behalf", async () => {
      const response = await submit(manuelAccount, [tick(timothy.id, 1)]);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ created: 1, corrected: 0, unchanged: 0 });

      const row = await currentRow(timothy.id, 1);
      // Section 14: the statement is the confirming leader's, the filing the actor's.
      expect(row.confirmed_by).toBe(mark.id);
      expect(row.recorded_by).toBe(manuelAccount.id);

      const [entry] = await auditOf('suynl_lesson.confirmed');
      expect(entry.actor_id).toBe(manuelAccount.id);
      expect(entry.target_id).toBe(timothy.id);
      expect(entry.after).toMatchObject({ lesson: 1, confirmed_by: mark.id, on_behalf: true });
    });
  });

  // ---------------------------------------------------------------------------
  // 3-4. Refusals, and all-or-nothing
  // ---------------------------------------------------------------------------

  describe('refusals', () => {
    it('refuses a person outside the actor’s scope', async () => {
      const response = await submit(markAccount, [tick(nathan.id, 1)]);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(await allRows()).toHaveLength(0);
    });

    it('refuses a leader filing for themselves (decision 0280)', async () => {
      const response = await submit(markAccount, [tick(mark.id, 1)]);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(await allRows()).toHaveLength(0);
    });

    it('refuses a Senior Pastor, a Network root with a Whole Church grant, filing for themselves', async () => {
      const response = await submit(raymondAccount, [tick(raymond.id, 1)]);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(await allRows()).toHaveLength(0);
    });

    it('refuses an Admin filing for themselves', async () => {
      const response = await submit(admin, [tick(admin.personId, 1)]);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(await allRows()).toHaveLength(0);
    });

    it('refuses an archived person (decision 0279)', async () => {
      for (const account of [markAccount, admin]) {
        const response = await submit(account, [tick(silas.id, 1)]);

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      }

      expect(await allRows()).toHaveLength(0);
    });

    it('refuses withdrawing an archived person’s lesson (decision 0279, a correction included)', async () => {
      await seedLessons(silas.id, [1], mark.id);
      const row = await currentRow(silas.id, 1);

      const response = await submit(markAccount, [
        {
          person_id: silas.id,
          lesson: 1,
          done: false,
          seen_id: row.id,
          reason: 'Ticked in error.',
        },
      ]);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect((await currentRow(silas.id, 1)).superseded_at).toBeNull();
    });

    it('lets a Whole Church holder file for a Network root, naming no confirming leader', async () => {
      const byAdmin = await submit(admin, [tick(raymond.id, 1)]);
      expect(byAdmin.status).toBe(201);
      expect(byAdmin.body.created).toBe(1);

      // The other root, filed by a Senior Pastor who is not that root.
      const bySeniorPastor = await submit(raymondAccount, [tick(grace.id, 1)]);
      expect(bySeniorPastor.status).toBe(201);

      expect((await currentRow(raymond.id, 1)).confirmed_by).toBeNull();
      expect((await currentRow(grace.id, 1)).confirmed_by).toBeNull();
      expect((await currentRow(grace.id, 1)).recorded_by).toBe(raymondAccount.id);
    });

    it('refuses a leader filing for a Network root', async () => {
      const response = await submit(manuelAccount, [tick(raymond.id, 1)]);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(await allRows()).toHaveLength(0);
    });

    it('writes nothing when one line of a batch is refused', async () => {
      const response = await submit(markAccount, [
        tick(timothy.id, 1),
        tick(timothy.id, 2),
        tick(nathan.id, 1),
      ]);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(await allRows()).toHaveLength(0);
      expect(await allAudit()).toHaveLength(0);
    });

    it('writes nothing when a later line names oneself', async () => {
      const response = await submit(manuelAccount, [tick(mark.id, 1), tick(manuel.id, 1)]);

      expect(response.status).toBe(403);
      expect(await allRows()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Withdrawal
  // ---------------------------------------------------------------------------

  describe('withdrawal', () => {
    it("names the corrected row's confirming leader, not the person's leader now", async () => {
      // Mark files lesson 1 for Timothy; Timothy then moves directly under Manuel, who
      // withdraws it. Section 28: a correction is attributed to the confirming leader
      // named on the row, never to anybody else — so the entry names Mark, and Manuel
      // acted on his behalf.
      await submit(markAccount, [tick(timothy.id, 1)]);
      const row = await currentRow(timothy.id, 1);
      expect(row.confirmed_by).toBe(mark.id);

      await reassign(timothy.id, manuel.id);

      const response = await submit(manuelAccount, [
        { person_id: timothy.id, lesson: 1, done: false, seen_id: row.id, reason: 'Not done.' },
      ]);
      expect(response.status).toBe(201);
      expect(response.body).toEqual({ created: 0, corrected: 1, unchanged: 0 });

      const [entry] = await auditOf('suynl_lesson.corrected');
      expect(entry.actor_id).toBe(manuelAccount.id);
      expect(entry.after).toMatchObject({ confirmed_by: mark.id, on_behalf: true });
    });

    it('supersedes the row with the corrector and reason, and audits the reason', async () => {
      await submit(markAccount, [tick(timothy.id, 3)]);
      const row = await currentRow(timothy.id, 3);

      const response = await submit(markAccount, [
        { person_id: timothy.id, lesson: 3, done: false, seen_id: row.id, reason: 'Not done yet.' },
      ]);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ created: 0, corrected: 1, unchanged: 0 });

      const after = await db
        .selectFrom('suynl_lessons')
        .selectAll()
        .where('id', '=', row.id)
        .executeTakeFirstOrThrow();
      expect(after.superseded_at).not.toBeNull();
      expect(after.corrected_by).toBe(markAccount.id);
      expect(after.correction_reason).toBe('Not done yet.');

      // Superseded, never deleted, and nothing replaces a retraction.
      expect(await allRows()).toHaveLength(1);
      expect(await currentRows(timothy.id)).toHaveLength(0);

      const [entry] = await auditOf('suynl_lesson.corrected');
      expect(entry.target_id).toBe(timothy.id);
      expect(entry.reason).toBe('Not done yet.');
      expect(entry.after).toMatchObject({ lesson: 3, withdrawn: true });
    });

    it('refuses a withdrawal with no reason', async () => {
      await submit(markAccount, [tick(timothy.id, 3)]);
      const row = await currentRow(timothy.id, 3);

      const response = await submit(markAccount, [
        { person_id: timothy.id, lesson: 3, done: false, seen_id: row.id },
      ]);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('reason');
      expect((await currentRow(timothy.id, 3)).superseded_at).toBeNull();
    });

    it('refuses a tick carrying a reason', async () => {
      const response = await submit(markAccount, [
        { ...tick(timothy.id, 3), reason: 'No reason is owed here.' },
      ]);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('reason');
      expect(await allRows()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. A stale save (decision 0282)
  // ---------------------------------------------------------------------------

  describe('a stale save', () => {
    it('answers a withdrawal of a row somebody else already withdrew as unchanged', async () => {
      await submit(markAccount, [tick(timothy.id, 4)]);
      const seen = await currentRow(timothy.id, 4);

      const other = await submit(manuelAccount, [
        { person_id: timothy.id, lesson: 4, done: false, seen_id: seen.id, reason: 'Duplicate.' },
      ]);
      expect(other.status).toBe(201);

      const rowsBefore = await allRows();
      const auditBefore = await allAudit();

      const response = await submit(markAccount, [
        { person_id: timothy.id, lesson: 4, done: false, seen_id: seen.id, reason: 'Wrong week.' },
      ]);

      // A withdrawal of something already withdrawn agrees with what is stored.
      // Decision 0282: "A change that already agrees with what is stored writes
      // nothing and conflicts with nothing."
      expect(response.status).toBe(201);
      expect(response.body).toEqual({ created: 0, corrected: 0, unchanged: 1 });
      expect(await allRows()).toEqual(rowsBefore);
      expect(await allAudit()).toHaveLength(auditBefore.length);
    });

    it('refuses a withdrawal naming a row that has since been replaced', async () => {
      await submit(markAccount, [tick(timothy.id, 4)]);
      const seen = await currentRow(timothy.id, 4);

      // Somebody else withdraws it and ticks it again: a new current row.
      await submit(manuelAccount, [
        { person_id: timothy.id, lesson: 4, done: false, seen_id: seen.id, reason: 'Re-filing.' },
      ]);
      await submit(manuelAccount, [tick(timothy.id, 4)]);
      const replacement = await currentRow(timothy.id, 4);

      const rowsBefore = await allRows();
      const auditBefore = await allAudit();

      const response = await submit(markAccount, [
        tick(timothy.id, 5),
        { person_id: timothy.id, lesson: 4, done: false, seen_id: seen.id, reason: 'Wrong week.' },
      ]);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('VERSION_CONFLICT');
      expect(response.body.error.details.submitted_row).toBe(seen.id);
      expect(response.body.error.details.current_row).toBe(replacement.id);
      expect(response.body.error.details.submitted).toMatchObject({ lesson: 4, done: false });
      expect(response.body.error.details.current).toMatchObject({ lesson: 4, done: true });

      // Nothing written, the good line included.
      expect(await allRows()).toEqual(rowsBefore);
      expect(await allAudit()).toHaveLength(auditBefore.length);
    });

    it('refuses a tick made against a row that has since been withdrawn', async () => {
      // The client saw lesson 4 ticked (row A), then somebody withdrew it. A re-tick
      // naming A disagrees with nothing stored... except that A is no longer current.
      await submit(markAccount, [tick(timothy.id, 4)]);
      const seen = await currentRow(timothy.id, 4);
      await submit(manuelAccount, [
        { person_id: timothy.id, lesson: 4, done: false, seen_id: seen.id, reason: 'Not yet.' },
      ]);

      const rowsBefore = await allRows();

      const response = await submit(markAccount, [{ ...tick(timothy.id, 4), seen_id: seen.id }]);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('VERSION_CONFLICT');
      expect(response.body.error.details.submitted_row).toBe(seen.id);
      expect(response.body.error.details.current_row).toBeNull();
      expect(response.body.error.details).toHaveProperty('submitted');
      expect(response.body.error.details).toHaveProperty('current');
      expect(await allRows()).toEqual(rowsBefore);
    });

    it('answers a tick of a lesson somebody else already ticked as unchanged', async () => {
      await submit(manuelAccount, [tick(timothy.id, 5)]);
      const auditBefore = await allAudit();

      const response = await submit(markAccount, [tick(timothy.id, 5)]);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ created: 0, corrected: 0, unchanged: 1 });
      expect(await currentRows(timothy.id)).toHaveLength(1);
      expect(await allAudit()).toHaveLength(auditBefore.length);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Concurrency: the partial unique index, not the application check
  // ---------------------------------------------------------------------------

  describe('concurrent first ticks', () => {
    it('loses a first tick to an uncommitted one without a 500 or a second current row', async () => {
      // A holder inserts the lesson and does not commit, so the API's own insert
      // blocks on `suynl_lessons_one_current_per_lesson` and loses deterministically.
      // A sequential test cannot tell whether that index exists.
      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      const key = randomUUID();

      let response: request.Response;
      try {
        await holder.query('BEGIN');
        await holder.query(
          `INSERT INTO suynl_lessons (person_id, lesson, confirmed_by, recorded_by)
           VALUES ($1, 6, $2, $3)`,
          [timothy.id, manuel.id, manuelAccount.id],
        );

        const attempt = submit(markAccount, [tick(timothy.id, 6)], key);
        const inFlight = track(attempt);

        const waiters = await countWhileInFlight(
          async () => {
            const { rows } = await holder.query<{ count: string }>(
              `SELECT count(*) AS count FROM pg_locks
                WHERE NOT granted AND locktype IN ('transactionid', 'tuple')`,
            );
            return Number(rows[0].count);
          },
          inFlight,
          'the tick to block on suynl_lessons_one_current_per_lesson',
        );
        expect(waiters).toBeGreaterThan(0);

        await holder.query('COMMIT');
        response = await attempt;
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }

      expect(response.status).not.toBe(500);
      if (response.status === 201) {
        expect(response.body).toEqual({ created: 0, corrected: 0, unchanged: 1 });
      } else {
        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('RESOURCE_BUSY');
      }

      expect(await currentRows(timothy.id)).toHaveLength(1);

      // Section 22: the retry, with the same key, succeeds and writes nothing.
      const retry = await submit(markAccount, [tick(timothy.id, 6)], key);
      expect(retry.status).toBe(201);
      expect(retry.body).toEqual({ created: 0, corrected: 0, unchanged: 1 });
      expect(await currentRows(timothy.id)).toHaveLength(1);
      expect(await auditOf('suynl_lesson.confirmed')).toHaveLength(0);
    });

    it('never answers 500 or leaves two current rows under parallel first ticks', async () => {
      for (let lesson = 1; lesson <= 10; lesson += 1) {
        const responses = await Promise.all([
          submit(markAccount, [tick(timothy.id, lesson)]),
          submit(manuelAccount, [tick(timothy.id, lesson)]),
        ]);

        for (const response of responses) {
          expect([201, 503]).toContain(response.status);
          if (response.status === 503) {
            expect(response.body.error.code).toBe('RESOURCE_BUSY');
          }
        }

        const created = responses
          .filter((response) => response.status === 201)
          .reduce((sum, response) => sum + response.body.created, 0);
        expect(created).toBe(1);
      }

      expect(await currentRows(timothy.id)).toHaveLength(10);
      expect(await auditOf('suynl_lesson.confirmed')).toHaveLength(10);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Counts (decision 0281)
  // ---------------------------------------------------------------------------

  describe('counts', () => {
    beforeEach(async () => {
      await seedLessons(timothy.id, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], mark.id);
      await seedLessons(nathan.id, [1, 2, 3], manuel.id);
      // An archived person with lessons is neither listed nor counted (decision 0279).
      await seedLessons(silas.id, [1, 2], mark.id);
    });

    it("adds up to everyone the actor's tab lists", async () => {
      const response = await get(manuelAccount, 'counts');

      expect(response.status).toBe(200);
      // Manuel's subtree: Manuel, Mark, Nathan, Timothy. Silas is archived.
      expect(response.body).toEqual({ people: 4, not_started: 2, in_progress: 1, graduated: 1 });

      const listed = await allPages(manuelAccount, 'limit=200');
      expect(listed).toHaveLength(response.body.people);
    });

    it('reconciles for a Whole Church reader too', async () => {
      const response = await get(admin, 'counts');

      expect(response.status).toBe(200);
      const { people, not_started, in_progress, graduated } = response.body;
      expect(not_started + in_progress + graduated).toBe(people);

      const listed = await allPages(admin, 'limit=200');
      expect(listed).toHaveLength(people);
      expect(idsOf(listed)).not.toContain(silas.id);
    });

    it('each card narrows the list to exactly its count', async () => {
      const counts = (await get(manuelAccount, 'counts')).body;

      const graduated = await allPages(manuelAccount, 'step=GRADUATED');
      const inProgress = await allPages(manuelAccount, 'step=IN_PROGRESS');
      const notStarted = await allPages(manuelAccount, 'step=NOT_STARTED');

      expect(idsOf(graduated)).toEqual([timothy.id]);
      expect(idsOf(inProgress)).toEqual([nathan.id]);
      expect(new Set(idsOf(notStarted))).toEqual(new Set([manuel.id, mark.id]));

      expect(graduated).toHaveLength(counts.graduated);
      expect(inProgress).toHaveLength(counts.in_progress);
      expect(notStarted).toHaveLength(counts.not_started);
    });

    it('marks ten lessons as graduated, dated the day the tenth was filed', async () => {
      const [row] = (await get(manuelAccount, 'people?step=GRADUATED')).body.data;

      expect(row.lessons).toHaveLength(10);
      expect(row.graduated_on).toBe(manilaDayOf(await databaseNow(db)));

      const [partial] = (await get(manuelAccount, 'people?step=IN_PROGRESS')).body.data;
      expect(partial.lessons).toHaveLength(3);
      expect(partial.graduated_on).toBeNull();
    });

    it('withdrawing one of ten takes the graduation with it', async () => {
      const row = await currentRow(timothy.id, 10);
      const response = await submit(markAccount, [
        { person_id: timothy.id, lesson: 10, done: false, seen_id: row.id, reason: 'Not done.' },
      ]);
      expect(response.status).toBe(201);

      const counts = (await get(manuelAccount, 'counts')).body;
      expect(counts).toEqual({ people: 4, not_started: 2, in_progress: 2, graduated: 0 });
    });
  });

  // ---------------------------------------------------------------------------
  // 9. The list
  // ---------------------------------------------------------------------------

  describe('the list', () => {
    it('lists only direct disciples with mine=true', async () => {
      const rows = await allPages(manuelAccount, 'mine=true');

      expect(new Set(idsOf(rows))).toEqual(new Set([mark.id, nathan.id]));
    });

    it("shows the actor's own row with may_file false and disciples' rows with may_file true", async () => {
      const rows = await allPages(manuelAccount, 'limit=200');
      const byId = new Map(rows.map((row) => [row.person_id, row]));

      expect(byId.get(manuel.id)?.may_file).toBe(false);
      expect(byId.get(mark.id)?.may_file).toBe(true);
      expect(byId.get(nathan.id)?.may_file).toBe(true);
      // On behalf, through Mark.
      expect(byId.get(timothy.id)?.may_file).toBe(true);
      expect(byId.has(silas.id)).toBe(false);
    });

    it("shows a Senior Pastor's own row with may_file false and the other root's true", async () => {
      const rows = await allPages(raymondAccount, 'limit=200');
      const byId = new Map(rows.map((row) => [row.person_id, row]));

      expect(byId.get(raymond.id)?.may_file).toBe(false);
      expect(byId.get(grace.id)?.may_file).toBe(true);
      expect(byId.get(hannah.id)?.may_file).toBe(true);
    });

    it('returns every person exactly once across pages', async () => {
      const paged = await allPages(manuelAccount, 'limit=1');
      const ids = idsOf(paged);

      expect(ids).toHaveLength(4);
      expect(new Set(ids)).toEqual(new Set([manuel.id, mark.id, nathan.id, timothy.id]));
    });

    it('refuses an unresolvable cursor', async () => {
      const response = await get(manuelAccount, 'people?cursor=not-a-cursor');

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a forged cursor carrying unstorable text rather than answering 500', async () => {
      // The decoded names reach the keyset comparison; a null byte or a lone surrogate
      // there must be refused at the edge (section 22), for both Growth tabs.
      for (const lastName of ['Test\u0000fixture', 'Test\ud800fixture']) {
        const forged = Buffer.from(
          JSON.stringify({ lastName, firstName: 'Mark', id: randomUUID() }),
          'utf8',
        ).toString('base64url');

        for (const tab of ['suynl', 'training']) {
          const response = await request(app.getHttpServer())
            .get(`/api/v1/${tab}/people?cursor=${forged}`)
            .set('Authorization', `Bearer ${manuelAccount.accessToken}`);

          expect(response.status).toBe(422);
          expect(response.body.error.code).toBe('VALIDATION_FAILED');
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 11. Idempotency (section 22)
  // ---------------------------------------------------------------------------

  describe('idempotency', () => {
    it('replays the stored response and writes nothing twice', async () => {
      const key = randomUUID();
      const changes = [tick(timothy.id, 1), tick(timothy.id, 2)];

      const first = await submit(markAccount, changes, key);
      expect(first.status).toBe(201);
      expect(first.body).toEqual({ created: 2, corrected: 0, unchanged: 0 });

      const replay = await submit(markAccount, changes, key);
      expect(replay.status).toBe(201);
      // The stored answer, not a fresh one — a fresh one would say unchanged: 2.
      expect(replay.body).toEqual(first.body);

      expect(await allRows()).toHaveLength(2);
      expect(await auditOf('suynl_lesson.confirmed')).toHaveLength(2);
    });
  });
});
