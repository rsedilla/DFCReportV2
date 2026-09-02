import { randomUUID } from 'node:crypto';

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
 * How a Cell meeting is placed in the tree (SKILL.md section 7, the closed-Cell
 * exception).
 *
 * **The only dated scope resolution in the system.** Section 7's general rule is that a
 * write is acted on now and resolves through the Cell's current leader — and a closed
 * Cell has none, so every write against one resolves through nobody. The exception is
 * "recording or correcting a Cell meeting whose month's submission window is still
 * open, together with the meeting-scoped roster read that write requires: those resolve
 * through whoever led the Cell **on the meeting's date**."
 *
 * It is **per record rather than per Cell**, which no other target is: "A Cell handed
 * from A to B and then closed has meetings belonging to each, and resolving through the
 * last leader would show A the task (section 19) while denying A the write."
 *
 * That sentence is the whole test. A Cell led by Mark, handed to Nestor, then closed:
 * Mark must reach his own meetings and Nestor must reach his, and the last-leader
 * fallback would give Nestor both and Mark none.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('a closed Cell meeting resolves per record (section 7)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let root: TestPerson;
  let mark: TestPerson;
  let nestor: TestPerson;
  let cell: TestCell;
  let markAccount: TestAccount;
  let nestorAccount: TestAccount;

  const CREATED = new Date('2024-01-06T10:00:00+08:00');

  /** Two Saturdays inside the open window: Mark's, then Nestor's. */
  let marksMeeting: string;
  let nestorsMeeting: string;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, root.id);
    nestor = await createPerson(db, { firstName: 'Nestor', network: 'MENS' });
    await assignTo(db, nestor.id, root.id);

    cell = await createCell(db, { leader: mark, dayOfWeek: 6, createdAt: CREATED });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
    nestorAccount = await createAccount(app, db, { person: nestor, roles: ['LEADER'] });

    // Two consecutive Saturdays that have already happened, from the database's clock —
    // the same clock the window comparison uses. A fixed pair would start failing on the
    // day the month it names closes.
    const days = await sql<{ recent: string; earlier: string }>`
      SELECT to_char(saturday, 'YYYY-MM-DD')                     AS recent,
             to_char(saturday - interval '7 days', 'YYYY-MM-DD') AS earlier
        FROM (
          SELECT (now() AT TIME ZONE 'Asia/Manila')::date
                   - ((EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Asia/Manila')::date)::int + 1) % 7)
                 AS saturday
        ) AS s
    `.execute(db);

    marksMeeting = days.rows[0].earlier;
    nestorsMeeting = days.rows[0].recent;

    // Mark leads until the **day after** his meeting; Nestor from then; the Cell closes
    // after Nestor's. Every instant is derived from the two dates, so the whole fixture
    // moves with the calendar.
    //
    // **The handover is a day clear of the meeting deliberately, and that is a
    // disclosure rather than convenience.** The leadership lookup compares Manila
    // dates, which section 13 requires at the closure boundary — so on a day when a
    // handover *also* happens, both the outgoing and incoming rows cover the date and
    // the comparison cannot tell which of them was leading when the meeting took place.
    // Section 13 settles week-versus-day and says nothing about same-day, and inventing
    // an answer here would be a rule nobody decided. It is recorded as open in
    // `CLAUDE.md`; this fixture stays on the case section 7 actually describes.
    const handover = new Date(`${marksMeeting}T23:00:00+08:00`);
    handover.setUTCDate(handover.getUTCDate() + 1);
    const closure = new Date(`${nestorsMeeting}T23:00:00+08:00`);

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cell_leaderships')
        .set({ ended_at: handover })
        .where('cell_id', '=', cell.id)
        .where('ended_at', 'is', null)
        .execute();

      await trx
        .insertInto('cell_leaderships')
        .values({ person_id: nestor.id, cell_id: cell.id, started_at: handover })
        .execute();
    });

    await closeCellDirectly(db, cell.id, { reason: 'MEMBERS_DISPERSED', at: closure });
  });

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  const roster = (meetingId: string, as: TestAccount) =>
    request(app.getHttpServer())
      .get(`/api/v1/cells/${cell.id}/meetings/${meetingId}/roster`)
      .set('Authorization', `Bearer ${as.accessToken}`);

  const submit = (meetingId: string, as: TestAccount, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/v1/cells/${cell.id}/meetings/${meetingId}/submit`)
      .set('Authorization', `Bearer ${as.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  it('lets the leader of the day reach their own meeting, on a closed Cell', async () => {
    // Mark led the Cell on his meeting's date. Under the last-leader fallback he would
    // be refused it, because the Cell's last leader is Nestor.
    const response = await roster(marksMeeting, markAccount);

    expect(response.status).toBe(200);
    expect(response.body.responsible_leader_id).toBe(mark.id);
  });

  it('refuses the last leader a meeting that was not theirs', async () => {
    // The other half, and the one the fallback gets wrong in the opposite direction:
    // Nestor is the Cell's last leader, and Mark's meeting is not his to file.
    const response = await roster(marksMeeting, nestorAccount);

    expect(response.status).toBe(403);
  });

  it('lets the last leader reach the meeting that was theirs', async () => {
    const response = await roster(nestorsMeeting, nestorAccount);

    expect(response.status).toBe(200);
    expect(response.body.responsible_leader_id).toBe(nestor.id);
  });

  it('refuses the earlier leader a meeting held after they handed over', async () => {
    const response = await roster(nestorsMeeting, markAccount);

    expect(response.status).toBe(403);
  });

  it('lets the leader of the day record their own meeting, on a closed Cell', async () => {
    // **The write, which is what section 7's exception exists for**: "a closed Cell has
    // no current leader and the record would otherwise be unfilable."
    //
    // It asserts a 201 rather than a refusal, and the first version did not — it sent
    // an invalid `not_held_reason` and asserted 422, on the reasoning that a 422 rather
    // than a 403 showed the guard had let it through. It does not: the guard's own date
    // refusal is `VALIDATION_FAILED`, which is also 422, so the status could not
    // distinguish the layer it claimed to. Worse, it left the write half of section 7's
    // exception never once demonstrated to work — the thing the whole branch is for.
    const response = await submit(marksMeeting, markAccount, {
      status: 'NOT_HELD',
      not_held_reason: 'NO_MEMBERS_AVAILABLE',
    });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('NOT_HELD');
    // Frozen to the leader of the day, not to the Cell's last leader (section 13).
    expect(response.body.responsible_leader_id).toBe(mark.id);
  });

  it('refuses the leader of the day once that month has shut', async () => {
    // **The bound that keeps the exception consistent with the rule it excepts.**
    // Section 7: "once the window shuts, that too resolves through nobody and only
    // Admin can amend." Without it, a former leader of a closed Cell would keep
    // authority over their old meetings indefinitely — which is the "authority resolved
    // as of an effective date the actor chooses" that section 7 refuses, reached by
    // waiting instead of by choosing.
    //
    // A Saturday roughly a year back: inside Mark's tenure, derived by the schedule,
    // and in a month that shut long ago. Added because a mutation disabling the window
    // check passed every other case in this file — all of them use meetings inside the
    // open window, where the bound never fires.
    const old = await sql<{ day: string }>`
      SELECT to_char(
               ((now() AT TIME ZONE 'Asia/Manila')::date - interval '1 year')::date
                 - ((EXTRACT(ISODOW FROM ((now() AT TIME ZONE 'Asia/Manila')::date
                      - interval '1 year')::date)::int + 1) % 7),
               'YYYY-MM-DD'
             ) AS day
    `.execute(db);

    const response = await roster(old.rows[0].day, markAccount);

    expect(response.status).toBe(403);
  });

  it('refuses the previous leader on an ACTIVE Cell that changed hands', async () => {
    // **The other side of the exception, and section 7's asymmetry stated as a case.**
    // The dated resolution is for a Cell with no current leader to resolve through. An
    // ACTIVE Cell has one, so a write against it resolves through whoever holds it
    // *now* — and its former leader cannot file their own last meeting, while the same
    // person on a *closed* Cell can. That reads oddly until you see what it protects: a
    // leader who still has a Cell is accountable through the person holding it, and a
    // closed Cell leaves nobody in that position.
    //
    // Added because a mutation making the ACTIVE branch resolve by date too passed
    // every other case in this file and in the submit suite: the closed-Cell cases
    // cannot see it, and the submit suite's handover case files as an Admin, who is in
    // scope either way.
    const owner = await createPerson(db, { firstName: 'Rafael', network: 'MENS' });
    await assignTo(db, owner.id, root.id);
    const successor = await createPerson(db, { firstName: 'Teodoro', network: 'MENS' });
    await assignTo(db, successor.id, root.id);

    const active = await createCell(db, { leader: owner, dayOfWeek: 6, createdAt: CREATED });
    const ownerAccount = await createAccount(app, db, { person: owner, roles: ['LEADER'] });

    const handover = new Date(`${marksMeeting}T23:00:00+08:00`);
    handover.setUTCDate(handover.getUTCDate() + 1);

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cell_leaderships')
        .set({ ended_at: handover })
        .where('cell_id', '=', active.id)
        .where('ended_at', 'is', null)
        .execute();

      await trx
        .insertInto('cell_leaderships')
        .values({ person_id: successor.id, cell_id: active.id, started_at: handover })
        .execute();
    });

    // Rafael led the Cell on that date, and the Cell is ACTIVE, so scope resolves
    // through Teodoro who holds it now.
    const response = await request(app.getHttpServer())
      .get(`/api/v1/cells/${active.id}/meetings/${marksMeeting}/roster`)
      .set('Authorization', `Bearer ${ownerAccount.accessToken}`);

    expect(response.status).toBe(403);
  });

  it.each(['-09-31', '-02-30', '-13-05', '-09-99'])(
    'refuses a %s that has the shape of a date and is not one',
    async (suffix) => {
      // **A shape check is not a date check, and the difference was a 500.** Each of
      // these satisfies `\d{4}-\d{2}-\d{2}`, which is what the guard checked first;
      // PostgreSQL answers each with `22008 date/time field value out of range`, which
      // no error filter here recognises. So the value passed the guard, reached
      // `::date` in `leaderOnDateWithin`, and answered `INTERNAL_ERROR`.
      //
      // Two things made it worse than an ordinary 500. It happened in `resolveTarget`,
      // **before** `authorize`, so an authenticated caller holding no capability at all
      // reached it. And it only happened for a closed Cell in an open month — an ACTIVE
      // Cell returns before the cast — so the status was an oracle for that state.
      //
      // The case below passes `not-a-date`, which the shape check already refused, so
      // it could never have found this. These are the values that separate the two
      // checks.
      //
      // **The year comes from the meeting's own month, not from a literal, and the
      // first version hard-coded all four.** The old check only reached the SQL cast
      // for a closed Cell in an **open** month — so `2026-02-30`, written in September
      // 2026, was already a 403 rather than the 500 the comment described, and the
      // other three would have stopped demonstrating it within months. They would still
      // pass, and would silently stop testing what they name. The fixture sixty lines
      // above solves this deliberately and says so; these cases now do the same.
      const impossible = marksMeeting.slice(0, 4) + suffix;

      const response = await roster(impossible, markAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    },
  );

  it('refuses a meeting date that is not a date', async () => {
    // The guard resolves against this parameter, so section 7 requires the route to
    // validate it: a malformed value would otherwise reach a `date` comparison in SQL
    // and answer with a database error rather than a refusal.
    const response = await roster('not-a-date', markAccount);

    expect(response.status).toBe(422);
  });
});
