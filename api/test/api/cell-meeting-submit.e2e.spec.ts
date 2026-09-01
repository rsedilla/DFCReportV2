import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
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
 * `POST /api/v1/cells/{id}/meetings/{meeting_id}/submit` (SKILL.md sections 12, 13, 14).
 *
 * **A first submission, which is the only thing this route makes.** A second one is a
 * correction — a different operation on a record that already exists, which section 13's
 * change history covers — and is refused here rather than silently overwriting, which
 * section 14 forbids in terms.
 *
 * The cases that matter are the ones section 20 will reconcile against: a `HELD` meeting
 * carries a line for **every** member, present or not, so that classification and
 * monthly-attendance buckets can sum to the same unique-people total. A roster with
 * holes in it cannot do that, and the defect is invisible until a month is reported.
 *
 * The meeting is the version unit (section 14), which is the opposite of DCC.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('recording a Cell meeting (sections 12, 13 and 14)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let root: TestPerson;
  let mark: TestPerson;
  let markCell: TestCell;
  let markAccount: TestAccount;

  const CREATED = new Date('2026-01-03T10:00:00+08:00');
  /** A Saturday inside the open window while these tests run. */
  let meetingDate: string;

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
    markCell = await createCell(db, { leader: mark, dayOfWeek: 6, createdAt: CREATED });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

    meetingDate = await mostRecentSaturday();
  });

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  /**
   * The last Saturday on or before today, as a Manila date, read from the database.
   *
   * **The window is real, so the date has to be.** Section 13 shuts a month at the end
   * of the 7th of the next and the service decides that on the database's clock, so a
   * fixed date would start refusing the day the month it names closes — a case that
   * passes for weeks and then fails on a date nobody changed. The most recent Saturday
   * that has already happened is inside the open window on every day of the year.
   *
   * From the database rather than from the host, which is the rule this repository
   * keeps: the window comparison and this date must come from one clock.
   */
  async function mostRecentSaturday(): Promise<string> {
    const result = await sql<{ day: string }>`
      SELECT to_char(
               (now() AT TIME ZONE 'Asia/Manila')::date
                 - ((EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Asia/Manila')::date)::int + 1) % 7),
               'YYYY-MM-DD'
             ) AS day
    `.execute(db);

    return result.rows[0].day;
  }

  /** A member of Mark's Cell from well before any meeting these cases record. */
  async function member(firstName: string): Promise<TestPerson> {
    const person = await createPerson(db, { firstName, network: 'MENS' });
    await assignTo(db, person.id, mark.id);
    await db
      .insertInto('cell_memberships')
      .values({
        person_id: person.id,
        cell_id: markCell.id,
        started_at: CREATED,
      } as never)
      .execute();

    return person;
  }

  const submit = (body: Record<string, unknown>, as: TestAccount = markAccount, date?: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/cells/${markCell.id}/meetings/${date ?? meetingDate}/submit`)
      .set('Authorization', `Bearer ${as.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  it('records a HELD meeting with a line for every member', async () => {
    const one = await member('Aurelio');
    const two = await member('Bartolome');

    const response = await submit({
      status: 'HELD',
      attendance: [
        { person_id: one.id, present: true },
        { person_id: two.id, present: false },
      ],
    });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('HELD');
    expect(response.body.recorded).toBe(2);
    expect(response.body.present).toBe(1);
    // Section 13: frozen at the meeting's own date, and defaulting the facilitator to
    // that leader rather than to whoever submitted.
    expect(response.body.responsible_leader_id).toBe(mark.id);
    expect(response.body.facilitated_by).toBe(mark.id);
    expect(response.body.version).toBe(1);
  });

  it('refuses a HELD meeting that leaves a member out', async () => {
    // **The case section 20's reconciliation depends on.** Section 13: a meeting where
    // nobody came "is HELD with zero attendance... every member is recorded as not
    // having attended". Absent rows and rows marked absent are different facts, and
    // accepting a partial list makes the denominator depend on how much of the roster a
    // client happened to send.
    const one = await member('Aurelio');
    await member('Bartolome');

    const response = await submit({
      status: 'HELD',
      attendance: [{ person_id: one.id, present: true }],
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('records a HELD meeting nobody attended, with everyone marked absent', async () => {
    // Section 13: "If the leader was present and the meeting was available, the meeting
    // is HELD with zero attendance. It counts in the denominator." Zero present is not
    // the same fact as NOT_HELD, and this is the pair that keeps them apart.
    const one = await member('Aurelio');
    const two = await member('Bartolome');

    const response = await submit({
      status: 'HELD',
      attendance: [
        { person_id: one.id, present: false },
        { person_id: two.id, present: false },
      ],
    });

    expect(response.status).toBe(201);
    expect(response.body.recorded).toBe(2);
    expect(response.body.present).toBe(0);
  });

  it('records NOT_HELD with a reason and no attendance', async () => {
    await member('Aurelio');

    const response = await submit({
      status: 'NOT_HELD',
      not_held_reason: 'WEATHER_OR_CALAMITY',
    });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('NOT_HELD');
    expect(response.body.recorded).toBe(0);
  });

  it('refuses attendance on a meeting that did not take place', async () => {
    const one = await member('Aurelio');

    const response = await submit({
      status: 'NOT_HELD',
      not_held_reason: 'LEADER_UNAVAILABLE',
      attendance: [{ person_id: one.id, present: true }],
    });

    expect(response.status).toBe(409);
  });

  it('refuses a person who was not a member on the meeting date', async () => {
    // Section 12 records attendance for members only and has no visitor state: "A
    // person coming to a Cell for the first time is added as a member by the leader,
    // and then recorded present."
    //
    // **Every member is named as well, and that is what makes this case about the
    // roster rule.** A first version submitted the outsider alone, so the whole roster
    // was missing too — and the refusal it observed came from the every-member rule
    // rather than this one. A mutation widening the roster to include whoever was
    // submitted passed it. With the members present, `missing` is empty and only the
    // membership check can refuse.
    const one = await member('Aurelio');
    const outsider = await createPerson(db, { firstName: 'Zenaida', network: 'MENS' });
    await assignTo(db, outsider.id, mark.id);

    const response = await submit({
      status: 'HELD',
      attendance: [
        { person_id: one.id, present: true },
        { person_id: outsider.id, present: true },
      ],
    });

    expect(response.status).toBe(409);
  });

  it('refuses a second submission, because that is a correction', async () => {
    const one = await member('Aurelio');
    const body = { status: 'HELD', attendance: [{ person_id: one.id, present: true }] };

    expect((await submit(body)).status).toBe(201);

    const second = await submit(body);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('names the Cell leader when an upline submits on behalf', async () => {
    // **Section 14 separates conducting from reporting, and this is the second.** An
    // upline entering the record changes neither who the responsible leader is nor who
    // the facilitator defaults to — section 13 defaults `facilitated_by` to "the
    // meeting's responsible leader... and not whoever holds the Cell when the record is
    // entered".
    //
    // Added because a mutation defaulting the facilitator to the submitter passed every
    // other case in this file: each of them submits as the Cell's own leader, so the
    // two values coincide and nothing could tell them apart.
    const one = await member('Aurelio');
    const adminPerson = await createPerson(db, { firstName: 'Admin', network: 'MENS' });
    await assignTo(db, adminPerson.id, root.id);
    const admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    const response = await submit(
      { status: 'HELD', attendance: [{ person_id: one.id, present: true }] },
      admin,
    );

    expect(response.status).toBe(201);
    expect(response.body.responsible_leader_id).toBe(mark.id);
    expect(response.body.facilitated_by).toBe(mark.id);
  });

  it('names whoever led the Cell on the meeting date, not whoever leads it now', async () => {
    // **Section 13's freeze, and the case that pins it.** "Whoever led it then, not
    // whoever leads it now" — `responsible_leader_id` is resolved from
    // `cell_leaderships` at the meeting's own date, so a meeting submitted after a
    // handover keeps the leader it belongs to.
    //
    // Added because a mutation resolving the leader through `leaderForScopeWithin` —
    // the *current* leader — passed every other case: no fixture here had ever changed
    // hands, so the two answers were the same person.
    const one = await member('Aurelio');

    const successor = await createPerson(db, { firstName: 'Nestor', network: 'MENS' });
    await assignTo(db, successor.id, root.id);

    // Handed over the day after the meeting: Mark led it, Nestor leads the Cell now.
    const handover = new Date(`${meetingDate}T12:00:00+08:00`);
    handover.setUTCDate(handover.getUTCDate() + 1);

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cell_leaderships')
        .set({ ended_at: handover })
        .where('cell_id', '=', markCell.id)
        .where('ended_at', 'is', null)
        .execute();

      await trx
        .insertInto('cell_leaderships')
        .values({
          person_id: successor.id,
          cell_id: markCell.id,
          started_at: handover,
        } as never)
        .execute();
    });

    // **Filed by somebody still in scope, and that is section 7 rather than a
    // convenience.** A write against an ACTIVE Cell resolves through its *current*
    // leader, so once the Cell has changed hands Mark cannot file his own meeting — an
    // upline does, or the new leader. Section 7's per-record exception is for a
    // **closed** Cell and does not reach this one. Submitting as Mark answers 403,
    // which is the specification working rather than a defect, and it is why this case
    // submits as an Admin.
    const adminPerson = await createPerson(db, { firstName: 'Admin', network: 'MENS' });
    await assignTo(db, adminPerson.id, root.id);
    const admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    const response = await submit(
      { status: 'HELD', attendance: [{ person_id: one.id, present: true }] },
      admin,
    );

    expect(response.status).toBe(201);
    // Mark, not Nestor who leads it now, and not the Admin who entered it.
    expect(response.body.responsible_leader_id).toBe(mark.id);
    expect(response.body.facilitated_by).toBe(mark.id);
  });

  it('refuses a date the Cell was not scheduled to meet on', async () => {
    await member('Aurelio');

    // The day after a Saturday meeting is a Sunday, which this Cell does not meet on.
    const sunday = new Date(`${meetingDate}T12:00:00+08:00`);
    sunday.setUTCDate(sunday.getUTCDate() + 1);
    const sundayDate = sunday.toISOString().slice(0, 10);

    const response = await submit(
      { status: 'NOT_HELD', not_held_reason: 'OTHER', not_held_note: 'n/a' },
      markAccount,
      sundayDate,
    );

    expect(response.status).toBe(404);
  });
});
