import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { sql } from 'kysely';
import request from 'supertest';

import { countWhileInFlight, track } from '../setup/concurrency';
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

  /**
   * An account holding exactly the capabilities named, and no role at all.
   *
   * **The only way to hold one Cell capability and not another.** A `LEADER` holds
   * `cell.take_attendance`, `cell.submit_on_behalf` and `cell.correct_subtree` all at
   * `OWN_SUBTREE`, so a role-based actor passes every check and could not tell them
   * apart. Section 7 permits a grant with no role behind it: "A capability without an
   * explicit scope grant is not usable", which says nothing about a role.
   *
   * The Person is Root, who is upline of Mark — `OWN_SUBTREE` must reach the leader the
   * meeting resolves through for the guard to pass, and Mark already holds an account.
   */
  async function granted(capabilities: string[]): Promise<TestAccount> {
    const admin = await adminAccount();
    const account = await createAccount(app, db, { person: root, roles: [] });

    for (const capability of capabilities) {
      await db
        .insertInto('capability_grants')
        .values({
          account_id: account.id,
          capability: capability as never,
          scope_type: 'OWN_SUBTREE',
          read_only: false,
          reason: 'Invented for this case (CLAUDE.md, Secrets).',
          granted_by: admin.id,
        })
        .execute();
    }

    return account;
  }

  /** An Admin, for the cases where the corrector must not be the original submitter. */
  async function adminAccount(): Promise<TestAccount> {
    const person = await createPerson(db, { firstName: 'Admina', network: 'MENS' });
    await assignTo(db, person.id, root.id);

    return createAccount(app, db, { person, roles: ['ADMIN'] });
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
      })
      .execute();

    return person;
  }

  /** A member over an explicit window, for the cases where the roster moves under a date. */
  async function memberBetween(
    firstName: string,
    from: Date,
    to: Date | null = null,
  ): Promise<TestPerson> {
    const person = await createPerson(db, { firstName, network: 'MENS' });
    await assignTo(db, person.id, mark.id);
    await db
      .insertInto('cell_memberships')
      .values({ person_id: person.id, cell_id: markCell.id, started_at: from, ended_at: to })
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

  it('answers a second submission carrying no version by what it says, not by its absence', async () => {
    // **This case used to refuse a second submission outright**, because the route made
    // only first submissions and section 14 forbids silently overwriting one. It now
    // makes both, and section 22's two rules compose to decide this one:
    //
    //   - a submission that **agrees** with the committed state "takes no part in the
    //     version check … and the identical body resubmitted succeeds, writing nothing";
    //   - a submission that **disagrees** and carries no version is the first
    //     null-`submitted_version` case — "it came into existence while this client was
    //     drafting, which is the same problem from the other side".
    //
    // So the absence of a version does not decide it on its own, and an earlier version
    // of this case asserted that it did.
    const one = await member('Aurelio');
    const two = await member('Bartolome');
    const body = {
      status: 'HELD',
      attendance: [
        { person_id: one.id, present: true },
        { person_id: two.id, present: false },
      ],
    };

    expect((await submit(body)).status).toBe(201);

    // The identical body again: nothing differs, so nothing is written and nothing moves.
    const agreeing = await submit(body);
    expect(agreeing.status).toBe(201);
    expect(agreeing.body.corrected).toBe(0);
    expect(agreeing.body.version).toBe(1);

    // A differing body with no version: the client believed there was no record, and the
    // one there is says something else.
    const disagreeing = await submit({
      status: 'HELD',
      attendance: [
        { person_id: one.id, present: false },
        { person_id: two.id, present: false },
      ],
    });

    expect(disagreeing.status).toBe(409);
    expect(disagreeing.body.error.code).toBe('VERSION_CONFLICT');
    expect(disagreeing.body.error.details.submitted_version).toBeNull();
    expect(disagreeing.body.error.details.current_version).toBe(1);
    expect(disagreeing.body.error.details.submitted.present).toBe(0);
    expect(disagreeing.body.error.details.current.present).toBe(1);
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
        })
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

  describe('a handover on the meeting’s own day (section 13, decision 0187)', () => {
    /**
     * Hands `markCell` to a successor at an instant, and returns the successor.
     *
     * Written as one helper because the two cases below differ only in **when** the
     * meeting is filed relative to this call, and that difference is the whole rule.
     */
    async function handOver(at: Date): Promise<TestPerson> {
      const successor = await createPerson(db, { firstName: 'Nestor', network: 'MENS' });
      await assignTo(db, successor.id, root.id);

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_leaderships')
          .set({ ended_at: at })
          .where('cell_id', '=', markCell.id)
          .where('ended_at', 'is', null)
          .execute();

        await trx
          .insertInto('cell_leaderships')
          .values({ person_id: successor.id, cell_id: markCell.id, started_at: at })
          .execute();
      });

      return successor;
    }

    /** An Admin, so scope never decides these cases -- attribution is what they measure. */
    async function admin(): Promise<TestAccount> {
      const person = await createPerson(db, { firstName: 'Admina', network: 'MENS' });
      await assignTo(db, person.id, root.id);

      return createAccount(app, db, { person, roles: ['ADMIN'] });
    }

    it('gives the meeting to the leader who was in place when the day began', async () => {
      // Both leadership rows cover the meeting's date, because the lookup compares
      // Manila dates -- which section 13 requires at the closure boundary. The
      // earlier-starting one wins, so a Cell handed over at noon keeps that day's
      // meeting with the leader who had it at midnight.
      const one = await member('Aurelio');
      await handOver(new Date(`${meetingDate}T12:00:00+08:00`));

      const response = await submit(
        { status: 'HELD', attendance: [{ person_id: one.id, present: true }] },
        await admin(),
      );

      expect(response.status).toBe(201);
      expect(response.body.responsible_leader_id).toBe(mark.id);
    });

    it('gives the same answer whether the record is filed before or after the handover', async () => {
      // **This is the argument the ruling turns on, and no frequency claim substitutes
      // for it.** Under the previous ordering the same meeting was attributed two
      // different ways: filed *before* the handover was recorded it found one leadership
      // row and answered with the outgoing leader, and filed afterwards it found two and
      // answered with the incoming one. Section 3 makes a past period reproducible and
      // section 13 freezes this value permanently, so an attribution that moves with the
      // clerk satisfies neither.
      //
      // Two Cells rather than two submissions to one, because a second submission to one
      // meeting is a correction and this route refuses it. The Cells are identical in
      // shape and differ only in whether the handover row exists when the meeting is
      // filed -- which is the variable the rule has to be independent of.
      const one = await member('Aurelio');
      const entering = await admin();

      // Cell A: filed while Mark's row is still the only one.
      const beforeHandover = await submit(
        { status: 'HELD', attendance: [{ person_id: one.id, present: true }] },
        entering,
      );

      expect(beforeHandover.status).toBe(201);
      expect(beforeHandover.body.responsible_leader_id).toBe(mark.id);

      // Cell B: the same day, the same shape, handed over at noon *before* it is filed.
      const ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
      await assignTo(db, ben.id, root.id);
      const bensCell = await createCell(db, { leader: ben, dayOfWeek: 6, createdAt: CREATED });

      const bensSuccessor = await createPerson(db, { firstName: 'Teodoro', network: 'MENS' });
      await assignTo(db, bensSuccessor.id, root.id);
      const noon = new Date(`${meetingDate}T12:00:00+08:00`);

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_leaderships')
          .set({ ended_at: noon })
          .where('cell_id', '=', bensCell.id)
          .where('ended_at', 'is', null)
          .execute();

        await trx
          .insertInto('cell_leaderships')
          .values({ person_id: bensSuccessor.id, cell_id: bensCell.id, started_at: noon })
          .execute();
      });

      const afterHandover = await request(app.getHttpServer())
        .post(`/api/v1/cells/${bensCell.id}/meetings/${meetingDate}/submit`)
        .set('Authorization', `Bearer ${entering.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ status: 'HELD' });

      expect(afterHandover.status).toBe(201);
      // Ben, who held the Cell when the day began -- not Teodoro, who holds it now and
      // whom the previous ordering named.
      expect(afterHandover.body.responsible_leader_id).toBe(ben.id);
    });
  });

  it('refuses RESCHEDULED on a first submission, which decision 0188 rests on', async () => {
    // **Two rules meet on this refusal, and only one of them is about shape.**
    //
    // Section 13's own reason is that a reschedule is a *change* to a record that
    // already exists: it is what `cell_meeting_changes` records, and a change row needs
    // a `from_status` and a `from_date`, which do not exist until a record does.
    //
    // The other is section 7's, and it is why this case exists now rather than with the
    // reschedule route. Decision 0188 resolves a closed Cell meeting's scope through its
    // frozen `responsible_leader_id`, and that value is actor-independent only because
    // the instant it is frozen from is the *scheduled* date. `actual_date` is chosen by
    // an actor — so if a first submission could carry one, an actor could freeze
    // themselves as a meeting's responsible leader and hold authority over it past the
    // Cell's closure, which is the shape section 7 refuses one field over.
    //
    // The DTO refused this before either ruling needed it to. What had no case was the
    // refusal itself, which is now a premise rather than a detail.
    //
    // **It moved out of the DTO when the correction path arrived**, and the code moved
    // with it. `RESCHEDULED` is legal on a *correction*, and whether this is one is a
    // fact about the database that a DTO cannot see — so the refusal is now the
    // service's, and a well-formed request breaking a domain rule is an
    // `INVARIANT_VIOLATION` rather than a validation error.
    const one = await member('Aurelio');

    // **No `actual_date` in the body, and the first version of this case sent one.**
    // The DTO then declared no such field, so `forbidNonWhitelisted` would have refused
    // the request whatever the status said — a case that passes with the status check
    // deleted, which is the shape this repository keeps catching. The DTO now *does*
    // declare `actual_date`, so that particular vacuity is gone; the status is still
    // sent alone, because what this case measures is the status rule and not the
    // schema's pairing of a date with `RESCHEDULED`.
    const response = await submit({
      status: 'RESCHEDULED',
      attendance: [{ person_id: one.id, present: true }],
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');

    // And nothing was written, which the status code alone does not say.
    const rows = await db.selectFrom('cell_meetings').select('id').execute();
    expect(rows).toHaveLength(0);
  });

  describe('correcting a meeting that already has a record (sections 14 and 22)', () => {
    /** Records the meeting once and returns its version, so each case starts from one. */
    async function recorded(
      lines: { person_id: string; present: boolean }[],
    ): Promise<{ version: number; meetingId: string }> {
      const first = await submit({ status: 'HELD', attendance: lines });
      expect(first.status).toBe(201);

      return { version: first.body.version as number, meetingId: first.body.meeting_id as string };
    }

    const liveRows = () =>
      db
        .selectFrom('cell_attendance')
        .select(['person_id', 'present', 'version', 'id'])
        .where('superseded_at', 'is', null)
        .execute();

    it('supersedes only the lines that changed, and bumps the meeting once', async () => {
      // **The meeting is the version unit** (section 14): one comparison decides the
      // whole roster. But a correction writes per line, and only where a line moved —
      // a leader flipping one name in twenty writes one pair of rows, not twenty.
      const one = await member('Aurelio');
      const two = await member('Bartolome');
      const { version } = await recorded([
        { person_id: one.id, present: true },
        { person_id: two.id, present: false },
      ]);

      const before = await liveRows();
      const unchangedId = before.find((row) => row.person_id === one.id)?.id;

      const response = await submit({
        status: 'HELD',
        version,
        attendance: [
          { person_id: one.id, present: true },
          { person_id: two.id, present: true },
        ],
      });

      expect(response.status).toBe(201);
      expect(response.body.corrected).toBe(1);
      expect(response.body.version).toBe(version + 1);

      const after = await liveRows();
      expect(after).toHaveLength(2);

      // Bartolome's row was replaced and carries the next version.
      const corrected = after.find((row) => row.person_id === two.id);
      expect(corrected).toMatchObject({ present: true, version: 2 });

      // Aurelio's is the row that was already there — the same id, untouched.
      expect(after.find((row) => row.person_id === one.id)?.id).toBe(unchangedId);
    });

    it('leaves the superseded row in place, pointing at its successor', async () => {
      // Section 1 principle 12 and section 14: a correction never overwrites. The record
      // carries its own history, which is what makes an attendance figure explicable
      // after the fact.
      const one = await member('Aurelio');
      const { version } = await recorded([{ person_id: one.id, present: false }]);

      await submit({
        status: 'HELD',
        version,
        attendance: [{ person_id: one.id, present: true }],
        correction_reason: 'miscounted on the night',
      }).expect(201);

      const chain = await db
        .selectFrom('cell_attendance')
        .select(['present', 'version', 'superseded_at', 'superseded_by', 'id', 'correction_reason'])
        .orderBy('version')
        .execute();

      expect(chain).toHaveLength(2);
      expect(chain[0]).toMatchObject({ present: false, version: 1 });
      expect(chain[1]).toMatchObject({ present: true, version: 2 });
      expect(chain[0].superseded_by).toBe(chain[1].id);
      expect(chain[0].superseded_at).not.toBeNull();

      // The reason belongs to the correction, not to the original.
      expect(chain[0].correction_reason).toBeNull();
      expect(chain[1].correction_reason).toBe('miscounted on the night');
    });

    it('begins the successor exactly where its predecessor ended', async () => {
      // **Migration 0013's contiguity rule, and the defect decision 0177 records
      // shipping twice.** The successor's `recorded_at` is read back in SQL from the row
      // just closed; carrying the instant through this process truncates `timestamptz`
      // microseconds to milliseconds and the successor begins early.
      //
      // Compared in the **database**, for the same reason: two values that came back
      // through node-postgres are both truncated to the same millisecond, so a
      // comparison in JavaScript agrees with itself whatever the code did.
      const one = await member('Aurelio');
      const { version } = await recorded([{ person_id: one.id, present: false }]);

      await submit({
        status: 'HELD',
        version,
        attendance: [{ person_id: one.id, present: true }],
      }).expect(201);

      const contiguous = await sql<{ ok: boolean }>`
        SELECT bool_and(successor.recorded_at = predecessor.superseded_at) AS ok
          FROM cell_attendance predecessor
          JOIN cell_attendance successor ON successor.id = predecessor.superseded_by
         WHERE predecessor.id <> successor.id
      `.execute(db);

      expect(contiguous.rows[0].ok).toBe(true);
    });

    it('refuses a stale version with both values, both actors and both timestamps', async () => {
      // Section 22 fixes this body and section 14 says why: "Present both values, with
      // who recorded each and when, and let an authorized user decide." A conflict
      // response that omits any of them cannot satisfy section 14.
      const one = await member('Aurelio');
      const two = await member('Bartolome');
      const { version } = await recorded([
        { person_id: one.id, present: true },
        { person_id: two.id, present: true },
      ]);

      // Somebody else corrects it first, so the version moves.
      await submit({
        status: 'HELD',
        version,
        attendance: [
          { person_id: one.id, present: true },
          { person_id: two.id, present: false },
        ],
      }).expect(201);

      // Now the stale client submits against the version it read.
      const response = await submit({
        status: 'HELD',
        version,
        attendance: [
          { person_id: one.id, present: false },
          { person_id: two.id, present: false },
        ],
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('VERSION_CONFLICT');

      const details = response.body.error.details;
      expect(details.submitted_version).toBe(version);
      expect(details.current_version).toBe(version + 1);

      // Both values, as present counts — which is what section 14's own example is
      // about: nine against eight is a disagreement about the roster rather than about
      // any one person.
      expect(details.submitted.present).toBe(0);
      expect(details.current.present).toBe(1);

      // Both actors and both timestamps, which are the halves a status code cannot say.
      expect(details.submitted.actor.name).toContain('Mark');
      expect(details.current.actor.name).toContain('Mark');
      expect(typeof details.submitted.recorded_at).toBe('string');
      expect(typeof details.current.recorded_at).toBe('string');
    });

    it('writes nothing at all when the submission changes nothing', async () => {
      // **An unchanged submission is not an amendment** (section 9's rule, and the
      // domain's rather than that domain's): the version guards against overwriting a
      // change nobody saw, and there is nothing here to overwrite.
      //
      // **So it moves nothing, including the meeting's version.** An earlier version
      // bumped it and wrote a `cell_attendance.corrected` entry, without requiring
      // `cell.correct_subtree` — which section 7 admits under neither reading: either it
      // is an amendment and the capability is required, or it is not and no correction
      // is recorded. A §21 reader filtering for corrections was finding acts that
      // corrected nothing, by actors who could not have corrected anything.
      const one = await member('Aurelio');
      const { version } = await recorded([{ person_id: one.id, present: true }]);
      const before = await liveRows();

      const response = await submit({
        status: 'HELD',
        version,
        attendance: [{ person_id: one.id, present: true }],
      });

      expect(response.status).toBe(201);
      expect(response.body.corrected).toBe(0);
      expect(response.body.version).toBe(version);

      // The same row, not a rewritten one.
      const after = await db.selectFrom('cell_attendance').select(['id']).execute();
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(before[0].id);

      // And no correction was recorded, which is the half the response cannot show.
      const entries = await db
        .selectFrom('audit_log')
        .select('action')
        .where('action', '=', 'cell_attendance.corrected')
        .execute();
      expect(entries).toHaveLength(0);
    });

    it('preserves the original submitter, which section 14 lists among what a correction keeps', async () => {
      const one = await member('Aurelio');
      const { version } = await recorded([{ person_id: one.id, present: true }]);

      const stored = await db
        .selectFrom('cell_meetings')
        .select(['submitted_by', 'submitted_at'])
        .executeTakeFirstOrThrow();

      const admin = await adminAccount();
      await submit(
        { status: 'HELD', version, attendance: [{ person_id: one.id, present: false }] },
        admin,
      ).expect(201);

      const afterwards = await db
        .selectFrom('cell_meetings')
        .select(['submitted_by', 'submitted_at'])
        .executeTakeFirstOrThrow();

      // Mark reported it; Admin corrected it. Section 14 preserves "actual
      // submitter/actor", so the meeting still names Mark and who corrected it lives in
      // the audit entry and in the successor row's `recorded_by`.
      expect(afterwards.submitted_by).toBe(stored.submitted_by);
      expect(afterwards.submitted_at).toStrictEqual(stored.submitted_at);

      const successor = await db
        .selectFrom('cell_attendance')
        .select('recorded_by')
        .where('superseded_at', 'is', null)
        .executeTakeFirstOrThrow();
      expect(successor.recorded_by).toBe(admin.id);
    });

    it('audits a correction whoever makes it, unlike a first submission', async () => {
      // Section 21 lists "Attendance corrections". A first submission by the meeting's
      // own leader writes no entry — the record is the entry — so this is the only place
      // the *fact of the change* is recorded.
      const one = await member('Aurelio');
      const { version } = await recorded([{ person_id: one.id, present: true }]);

      await submit({
        status: 'HELD',
        version,
        attendance: [{ person_id: one.id, present: false }],
      }).expect(201);

      const entries = await db
        .selectFrom('audit_log')
        .select(['action', 'target_type', 'target_id', 'after'])
        .where('action', '=', 'cell_attendance.corrected')
        .execute();

      expect(entries).toHaveLength(1);
      expect(entries[0].target_type).toBe('cell');
      expect(entries[0].target_id).toBe(markCell.id);
      expect(entries[0].after).toMatchObject({ corrected: 1, version: version + 1 });
    });

    it('refuses a corrector who holds cell.take_attendance and not cell.correct_subtree', async () => {
      // **Section 7 splits the two capabilities and this is the case that tells them
      // apart.** `cell.take_attendance` guards the first submission and
      // `cell.correct_subtree` an amendment of a record that already stands. A route
      // declares one capability, so the second is checked in the service.
      //
      // The actor holds the on-behalf capability too, because Root is not the leader this
      // meeting resolves through and section 14 requires it of recording somebody else's
      // meeting — so without it the refusal would be that one, and this case would be
      // measuring a different rule than its name claims.
      const one = await member('Aurelio');
      const { version } = await recorded([{ person_id: one.id, present: true }]);

      const upline = await granted(['cell.take_attendance', 'cell.submit_on_behalf']);

      const response = await submit(
        { status: 'HELD', version, attendance: [{ person_id: one.id, present: false }] },
        upline,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.error.details.capability).toBe('cell.correct_subtree');

      // And the record is untouched, which the status code does not say.
      const live = await liveRows();
      expect(live).toHaveLength(1);
      expect(live[0].present).toBe(true);
    });

    it('lets that same actor make a first submission, which is the other half of the split', async () => {
      // The complement, and it is what stops the case above passing for the wrong
      // reason: an actor refused *everything* would redden it too.
      const one = await member('Aurelio');
      const upline = await granted(['cell.take_attendance', 'cell.submit_on_behalf']);

      await submit(
        { status: 'HELD', attendance: [{ person_id: one.id, present: true }] },
        upline,
      ).expect(201);
    });

    it('refuses an upline who holds cell.take_attendance and not cell.submit_on_behalf', async () => {
      // **Section 14: "A higher authorized leader may take attendance on behalf of a
      // downline leader within their pastoral subtree."** That requires
      // `cell.submit_on_behalf`, which section 7 lists and which nothing consulted until
      // the ruling of 2026-09-03 — so an administrator could not grant somebody the
      // power to record their own Cell without also granting it for everyone beneath
      // them.
      //
      // Root reaches Mark's meeting through the subtree, so it is not Root's meeting.
      const one = await member('Aurelio');
      const upline = await granted(['cell.take_attendance']);

      const response = await submit(
        { status: 'HELD', attendance: [{ person_id: one.id, present: true }] },
        upline,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.error.details.capability).toBe('cell.submit_on_behalf');
      expect(await db.selectFrom('cell_meetings').select('id').execute()).toHaveLength(0);
    });

    it('asks nothing extra of the leader whose own meeting it is', async () => {
      // The other side of the rule, and what keeps it from being a tax on every leader:
      // an actor who *is* the leader the meeting resolves through is not recording for
      // another, so `cell.take_attendance` alone reaches it.
      //
      // **A fresh Cell and a fresh leader, because the actor has to be the one under
      // test.** The first version of this case created an account and then submitted as
      // `markAccount`, a `LEADER` holding every Cell capability — so it stayed green with
      // the whole check deleted, which is the shape this repository keeps catching.
      const ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
      await assignTo(db, ben.id, root.id);
      const bensCell = await createCell(db, { leader: ben, dayOfWeek: 6, createdAt: CREATED });

      const admin = await adminAccount();
      const bensAccount = await createAccount(app, db, { person: ben, roles: [] });

      await db
        .insertInto('capability_grants')
        .values({
          account_id: bensAccount.id,
          capability: 'cell.take_attendance',
          scope_type: 'OWN_SUBTREE',
          read_only: false,
          reason: 'Invented for this case (CLAUDE.md, Secrets).',
          granted_by: admin.id,
        })
        .execute();

      await request(app.getHttpServer())
        .post(`/api/v1/cells/${bensCell.id}/meetings/${meetingDate}/submit`)
        .set('Authorization', `Bearer ${bensAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ status: 'HELD' })
        .expect(201);
    });

    it('answers one refusal whatever the roster says, for an actor who may not record it', async () => {
      // **The ordering, and the defect it closes.** `cell.submit_on_behalf` decides
      // whether this meeting is the actor's to record at all, which is not a question
      // about its contents — so it is settled before the roster is compared.
      //
      // Placed after the comparison, the *success* answered what the refusal was withheld
      // to protect: an agreeing roster returned 201 and a differing one 403, so two
      // probes read the stored roster back on a meeting the actor may not record.
      // `dcc-attendance.e2e.spec.ts` pins the identical property one domain over —
      // "answers the same refusal for an off-checklist person whatever is stored".
      const one = await member('Aurelio');
      const { version } = await recorded([{ person_id: one.id, present: true }]);

      const upline = await granted(['cell.take_attendance']);

      const agreeing = await submit(
        { status: 'HELD', version, attendance: [{ person_id: one.id, present: true }] },
        upline,
      );
      const differing = await submit(
        { status: 'HELD', version, attendance: [{ person_id: one.id, present: false }] },
        upline,
      );

      // The same refusal, naming the same capability — so the pair carries no bit about
      // what is stored.
      expect(agreeing.status).toBe(403);
      expect(differing.status).toBe(403);
      expect(agreeing.body.error.code).toBe('SCOPE_DENIED');
      expect(differing.body.error.code).toBe('SCOPE_DENIED');
      expect(agreeing.body.error.details.capability).toBe('cell.submit_on_behalf');
      expect(differing.body.error.details.capability).toBe('cell.submit_on_behalf');
    });

    it('lets the current leader correct a meeting frozen to their predecessor', async () => {
      // **The defect this case exists for made the record uncorrectable by anybody who
      // should have been able to correct it.** `assertMayCorrect` resolved against the
      // meeting's frozen leader unconditionally, while the guard resolves an `ACTIVE`
      // Cell through its *current* leader (decisions 0186 and 0188). On a Cell that had
      // changed hands the two disagreed, so:
      //
      //   - the current leader passed the guard and was refused here, and
      //   - the former leader was refused by the guard.
      //
      // Section 7 says in terms that the current leader files it: "On an `ACTIVE` Cell
      // handed from A to B... B files it." Both checks now ask the same method.
      const one = await member('Aurelio');
      const { version } = await recorded([{ person_id: one.id, present: true }]);

      const successor = await createPerson(db, { firstName: 'Nestor', network: 'MENS' });
      await assignTo(db, successor.id, root.id);
      const successorAccount = await createAccount(app, db, {
        person: successor,
        roles: ['LEADER'],
      });

      // Handed over the day after the meeting, so the meeting stays Mark's and the Cell
      // becomes Nestor's.
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
          .values({ person_id: successor.id, cell_id: markCell.id, started_at: handover })
          .execute();
      });

      const response = await submit(
        { status: 'HELD', version, attendance: [{ person_id: one.id, present: false }] },
        successorAccount,
      );

      expect(response.status).toBe(201);
      expect(response.body.corrected).toBe(1);

      // And it still belongs to Mark, which is section 13's freeze: scope and ownership
      // are different questions.
      expect(response.body.responsible_leader_id).toBe(mark.id);
    });

    it('checks the correction capability before disclosing the stored record', async () => {
      // **Ordering, and it is the hazard `DccAttendanceService` documents.** A
      // `VERSION_CONFLICT` carries the stored present count and the submitter's name
      // (section 22), neither of which `GET .../roster` discloses — so raising it before
      // the capability check lets an actor who may not correct this record read it out of
      // the refusal, by sending any stale version.
      //
      // Under role defaults the residual sits inside the actor's own scope; it becomes a
      // section 8 disclosure under a grant section 7 explicitly permits, which is the
      // precondition DCC declined to rest on and this now does not either.
      const one = await member('Aurelio');
      await recorded([{ person_id: one.id, present: true }]);

      const admin = await adminAccount();
      // Root, who is upline of Mark. `OWN_SUBTREE` must reach the meeting's responsible
      // leader for the guard to pass, and Mark already holds an account —
      // `accounts_person_id_key` allows one per Person.
      const halfLeader = await createAccount(app, db, { person: root, roles: [] });

      await db
        .insertInto('capability_grants')
        .values({
          account_id: halfLeader.id,
          capability: 'cell.take_attendance',
          scope_type: 'OWN_SUBTREE',
          read_only: false,
          reason: 'Invented for this case (CLAUDE.md, Secrets).',
          granted_by: admin.id,
        })
        .execute();

      const response = await submit(
        { status: 'HELD', version: 99, attendance: [{ person_id: one.id, present: false }] },
        halfLeader,
      );

      // The capability refusal, not the conflict — so nothing about the stored record
      // is in the body.
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(JSON.stringify(response.body)).not.toContain('current_version');
      expect(JSON.stringify(response.body)).not.toContain('present');
    });

    it('records on_behalf and the reason on the correction entry', async () => {
      // Section 21: "**A correction made for somebody else is one entry that says so**...
      // whether it was somebody else's record to correct is an attribute of it, carried
      // on the entry with the responsible leader", and writing only the correction "loses
      // every amendment an upline made to a downline's records from the list that exists
      // to find them". And the reason belongs in the column section 21 gives it, not
      // inside `after`.
      //
      // *This quoted section 21 as naming `...submitted_on_behalf` until 2026-09-02. That
      // string appears nowhere in the specification, and the commit that corrected the
      // same invention in the service file said it had fixed "three places" when it had
      // fixed one — which is the "fix claimed but not made" pattern decisions 0123, 0150
      // and 0177 record, committed in the act of repairing an invented citation.*
      const one = await member('Aurelio');
      const { version } = await recorded([{ person_id: one.id, present: true }]);

      const admin = await adminAccount();
      await submit(
        {
          status: 'HELD',
          version,
          attendance: [{ person_id: one.id, present: false }],
          correction_reason: 'double counted',
        },
        admin,
      ).expect(201);

      const entry = await db
        .selectFrom('audit_log')
        .select(['after', 'reason'])
        .where('action', '=', 'cell_attendance.corrected')
        .executeTakeFirstOrThrow();

      expect(entry.reason).toBe('double counted');
      expect(entry.after).toMatchObject({ on_behalf: true, responsible_leader_id: mark.id });

      // And the Cell's own leader correcting their own meeting is not on behalf.
      const second = await db
        .selectFrom('cell_meetings')
        .select('version')
        .executeTakeFirstOrThrow();

      await submit({
        status: 'HELD',
        version: second.version,
        attendance: [{ person_id: one.id, present: true }],
      }).expect(201);

      const entries = await db
        .selectFrom('audit_log')
        .select('after')
        .where('action', '=', 'cell_attendance.corrected')
        .execute();

      expect(entries).toHaveLength(2);
      expect(entries[1].after).toMatchObject({ on_behalf: false });
    });

    it('answers a lost correction race from the committed state, not its own writes', async () => {
      // **The branch the previous fix batch added and left with no case, and it was
      // wrong.** Section 22: "The loser **re-reads the committed state** and answers on
      // what it finds — which is not the same question as what the winner wrote." That
      // re-read ran on the transaction, which under READ COMMITTED shows a transaction
      // its own uncommitted writes — so by the time a later line lost the race, the
      // successors already inserted for the earlier lines made every line "agree", and a
      // submission that genuinely disagreed was answered `RESOURCE_BUSY`.
      //
      // **Two API requests fired together do not reach this branch**, and the first
      // version of this case did exactly that and was vacuous: they serialise, the loser
      // re-reads a moved version and takes the ordinary version check. Deleting the whole
      // lost-race handler left it green. What is needed is a winner that commits *after*
      // the loser has passed the version check and started writing — so the winner is a
      // second connection holding a row lock, released once the request is provably
      // blocked on it.
      const one = await member('Aurelio');
      const two = await member('Bartolome');
      const { version } = await recorded([
        { person_id: one.id, present: true },
        { person_id: two.id, present: true },
      ]);

      const rows = await liveRows();
      const second = rows.find((row) => row.person_id === two.id);
      const meeting = await db
        .selectFrom('cell_meetings')
        .select('id')
        .where('cell_id', '=', markCell.id)
        .where('scheduled_date', '=', meetingDate)
        .executeTakeFirstOrThrow();

      const winner = new Client({ connectionString: process.env.DATABASE_URL });
      await winner.connect();

      let response;

      try {
        // The winner supersedes Bartolome's row and bumps the meeting, holding both row
        // locks open. Nothing is committed yet, so the request below still reads version
        // 1 and the pre-winner roster.
        await winner.query('BEGIN');

        // **The winner leaves Bartolome a live successor carrying the value the loser is
        // about to submit**, and that one statement is what makes this case discriminate
        // the fix from the defect it was written for. Without it Bartolome has no live
        // row at all, so `committed.get(two.id)` is `undefined`, every reading disagrees,
        // and the old on-`trx` answer was `VERSION_CONFLICT` too — the case passed
        // against the code it exists to refuse. With it, the transaction's own view has
        // every line agreeing (its own uncommitted successor for Aurelio, the winner's
        // for Bartolome) while the **committed** state still disagrees on Aurelio:
        // old code answers `RESOURCE_BUSY`, new code answers `VERSION_CONFLICT`.
        const successorId = randomUUID();
        await winner.query(
          `UPDATE cell_attendance SET superseded_at = clock_timestamp(), superseded_by = $2
             WHERE id = $1`,
          [second?.id, successorId],
        );
        await winner.query(
          `INSERT INTO cell_attendance
             (id, cell_meeting_id, person_id, present, recorded_by, recorded_at, version)
           VALUES ($1, $2, $3, false, $4,
                   (SELECT superseded_at FROM cell_attendance WHERE id = $5), 2)`,
          [successorId, meeting.id, two.id, markAccount.id, second?.id],
        );
        await winner.query('UPDATE cell_meetings SET version = version + 1 WHERE id = $1', [
          meeting.id,
        ]);

        // Aurelio first so the request supersedes a row it *can* take, then blocks on
        // Bartolome's — which is the interleaving the branch exists for.
        const attempt = submit({
          status: 'HELD',
          version,
          attendance: [
            { person_id: one.id, present: false },
            { person_id: two.id, present: false },
          ],
        });
        const inFlight = track(attempt);

        // **Blocked on *the winner's* row lock, named rather than counted.** An earlier
        // version counted any backend waiting on a `Lock` in this database, which
        // identifies neither the waiter nor what it waits on — and `CLAUDE.md` records an
        // orphaned jest process against `dfc_ci` as a live occurrence here, which is
        // exactly such a backend. `pg_blocking_pids` names the contention, which is the
        // direction `test/setup/concurrency.ts` argues for at length: a false positive is
        // the dangerous one.
        const winnerPid = Number(
          (await winner.query<{ pid: string }>('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );

        const waiting = await countWhileInFlight(
          async () => {
            const blocked = await sql<{ count: string }>`
              SELECT count(*) AS count
                FROM pg_stat_activity
               WHERE ${sql.lit(winnerPid)} = ANY (pg_blocking_pids(pid))
            `.execute(db);

            return Number(blocked.rows[0].count);
          },
          inFlight,
          'the correction to block on the winner’s row lock',
        );
        expect(waiting).toBeGreaterThan(0);

        await winner.query('COMMIT');
        response = await attempt;
      } finally {
        await winner.end();
      }

      // The loser re-qualified, found the row already superseded, rolled back, and
      // answered from the **committed** state — where Aurelio still disagrees with the
      // body it sent.
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('VERSION_CONFLICT');
      expect(response.body.error.details.submitted_version).toBe(version);
      expect(response.body.error.details.current_version).toBe(version + 1);

      // And it rolled back whole: the winner's supersession stands and the loser's does
      // not, so exactly one live row per person remains.
      const live = await liveRows();
      expect(live.filter((row) => row.person_id === one.id)).toHaveLength(1);
      expect(live.find((row) => row.person_id === one.id)?.present).toBe(true);
    });

    it('refuses a version for a meeting that has no record', async () => {
      // Section 22: a refusal with no second value to show is not a VERSION_CONFLICT,
      // whatever went stale — there is nothing to put in `current`. Reachable here in a
      // way its DCC counterpart is not: the client read a roster whose `meeting` was
      // null and sent a version anyway.
      const one = await member('Aurelio');

      const response = await submit({
        status: 'HELD',
        version: 1,
        attendance: [{ person_id: one.id, present: true }],
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(await db.selectFrom('cell_meetings').select('id').execute()).toHaveLength(0);
    });

    it('refuses a status change, which is a separate operation', async () => {
      const one = await member('Aurelio');
      const { version } = await recorded([{ person_id: one.id, present: true }]);

      const response = await submit({
        status: 'NOT_HELD',
        version,
        not_held_reason: 'WEATHER_OR_CALAMITY',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });
  });

  describe('moving a meeting (section 13, decision 0195)', () => {
    /** The Saturday a week after the scheduled one, which the meeting moves to. */
    const movedTo = () => {
      const day = new Date(`${meetingDate}T12:00:00+08:00`);
      day.setUTCDate(day.getUTCDate() + 7);

      return day.toISOString().slice(0, 10);
    };

    const changeRows = () =>
      db
        .selectFrom('cell_meeting_changes')
        .select(['from_status', 'to_status', 'from_date', 'to_date', 'reason'])
        .orderBy('occurred_at')
        .execute();

    const meetingRow = () =>
      db
        .selectFrom('cell_meetings')
        .select(['status', 'actual_date', 'reporting_month', 'week_starting', 'version'])
        .where('cell_id', '=', markCell.id)
        .where('scheduled_date', '=', meetingDate)
        .executeTakeFirstOrThrow();

    it('moves the actual date and leaves the identity, month and week alone', async () => {
      // Section 13: a reschedule "changes the meeting's actual date/time, never its
      // identity or which reporting period it belongs to". `responsible_leader_id` is
      // frozen too, which is what keeps a moved meeting from sliding between leaders'
      // totals inside a period that may have closed.
      const one = await member('Aurelio');

      const first = await submit({
        status: 'HELD',
        attendance: [{ person_id: one.id, present: true }],
      });
      expect(first.status).toBe(201);

      const before = await meetingRow();

      const moved = await submit({
        status: 'RESCHEDULED',
        version: 1,
        actual_date: movedTo(),
        actual_time: '19:30',
        attendance: [{ person_id: one.id, present: true }],
      });

      expect(moved.status).toBe(201);
      expect(moved.body.status).toBe('RESCHEDULED');
      expect(moved.body.responsible_leader_id).toBe(mark.id);

      const after = await meetingRow();
      expect(after.status).toBe('RESCHEDULED');
      expect(after.actual_date).toBe(movedTo());
      expect(after.reporting_month).toBe(before.reporting_month);
      expect(after.week_starting).toBe(before.week_starting);
      expect(after.version).toBe(2);

      const changes = await changeRows();
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        from_status: 'HELD',
        to_status: 'RESCHEDULED',
        from_date: meetingDate,
        to_date: movedTo(),
      });
    });

    it('takes the roster from the day it moved to, both directions', async () => {
      // **The whole of decision 0195.** Section 12 takes a rescheduled meeting's roster
      // from the actual date, "the people who could actually have been there" — so the
      // move carries that roster. A member who joined between the two dates gets a record
      // they did not have; one who left has theirs closed with nothing replacing it,
      // because section 12 makes them a non-member of this meeting rather than somebody
      // misrecorded.
      // **Both boundaries fall between the two dates, not on either of them.**
      // `membersAsOfWithin` compares Manila *dates* — `started_at::date <= on::date` and
      // `ended_at::date >= on::date` — so a membership ending at 23:00 on the meeting date
      // still covers that date, and one starting at 23:30 covers it too. A first version
      // put both on the meeting date, which made all three people members of it, and the
      // opening submission was rightly refused for naming an incomplete roster.
      const between = (days: number) => {
        const day = new Date(`${meetingDate}T12:00:00+08:00`);
        day.setUTCDate(day.getUTCDate() + days);

        return day;
      };

      const stayed = await member('Aurelio');
      const left = await memberBetween('Bartolome', CREATED, between(3));
      const joined = await memberBetween('Crisanto', between(3));

      await submit({
        status: 'HELD',
        attendance: [
          { person_id: stayed.id, present: true },
          { person_id: left.id, present: true },
        ],
      }).expect(201);

      const moved = await submit({
        status: 'RESCHEDULED',
        version: 1,
        actual_date: movedTo(),
        attendance: [
          { person_id: stayed.id, present: true },
          { person_id: joined.id, present: false },
        ],
      });

      expect(moved.status).toBe(201);
      expect(moved.body.recorded).toBe(2);

      const rows = await db
        .selectFrom('cell_attendance')
        .select(['person_id', 'present', 'superseded_at', 'superseded_by', 'id'])
        .execute();

      const liveRows = rows.filter((row) => row.superseded_at === null);
      expect(liveRows.map((row) => row.person_id).sort()).toEqual([stayed.id, joined.id].sort());

      // Bartolome's row is closed and names itself — decision 0183's shape, reached here
      // for the second occasion the specification recognises.
      const dropped = rows.find((row) => row.person_id === left.id);
      expect(dropped?.superseded_at).not.toBeNull();
      expect(dropped?.superseded_by).toBe(dropped?.id);
    });

    it('declares a moved meeting not held, keeping both records', async () => {
      // Section 13: "A `RESCHEDULED` meeting that ultimately does not take place may be
      // changed to `NOT_HELD`, preserving both records." Its attendance is closed, and a
      // `NOT_HELD` meeting carries none.
      const one = await member('Aurelio');

      await submit({
        status: 'HELD',
        attendance: [{ person_id: one.id, present: true }],
      }).expect(201);

      await submit({
        status: 'RESCHEDULED',
        version: 1,
        actual_date: movedTo(),
        attendance: [{ person_id: one.id, present: true }],
      }).expect(201);

      const notHeld = await submit({
        status: 'NOT_HELD',
        version: 2,
        not_held_reason: 'WEATHER_OR_CALAMITY',
      });

      expect(notHeld.status).toBe(201);
      expect(notHeld.body.status).toBe('NOT_HELD');

      const live = await db
        .selectFrom('cell_attendance')
        .select('id')
        .where('superseded_at', 'is', null)
        .execute();
      expect(live).toHaveLength(0);

      const rows = await db.selectFrom('cell_attendance').select(['id', 'superseded_by']).execute();
      expect(rows.every((row) => row.superseded_by === row.id)).toBe(true);

      // Both moves survive, which is what "preserving both records" asks for.
      const changes = await changeRows();
      expect(changes.map((row) => `${row.from_status}->${row.to_status}`)).toEqual([
        'HELD->RESCHEDULED',
        'RESCHEDULED->NOT_HELD',
      ]);
      expect(changes[1].reason).toBe('WEATHER_OR_CALAMITY');
    });

    it('refuses the transitions section 13 does not name', async () => {
      const one = await member('Aurelio');

      await submit({
        status: 'NOT_HELD',
        not_held_reason: 'LEADER_UNAVAILABLE',
      }).expect(201);

      // `NOT_HELD` means the meeting did not take place and is not being made up, so
      // moving it contradicts the fact just recorded.
      const revive = await submit({
        status: 'RESCHEDULED',
        version: 1,
        actual_date: movedTo(),
        attendance: [{ person_id: one.id, present: true }],
      });

      expect(revive.status).toBe(409);
      expect(revive.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(revive.body.error.details.current_status).toBe('NOT_HELD');
    });

    it('refuses HELD to NOT_HELD, which is a correction rather than a move', async () => {
      const one = await member('Aurelio');

      await submit({
        status: 'HELD',
        attendance: [{ person_id: one.id, present: true }],
      }).expect(201);

      const response = await submit({
        status: 'NOT_HELD',
        version: 1,
        not_held_reason: 'LEADER_UNAVAILABLE',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('refuses a reschedule with nowhere to move to', async () => {
      const one = await member('Aurelio');

      await submit({
        status: 'HELD',
        attendance: [{ person_id: one.id, present: true }],
      }).expect(201);

      const response = await submit({
        status: 'RESCHEDULED',
        version: 1,
        attendance: [{ person_id: one.id, present: true }],
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });
  });

  describe('amending a month that has closed (section 13, decision 0182)', () => {
    /**
     * A Saturday whose month shut on the 7th of the month after it.
     *
     * Nine weeks back, then walked forward to the next Saturday, so it is always well
     * clear of the boundary whatever day of the month the suite runs on. Read from the
     * database for the reason `mostRecentSaturday` gives: the window comparison and this
     * date must come from one clock.
     */
    async function closedMonthSaturday(): Promise<string> {
      const result = await sql<{ day: string }>`
        SELECT to_char(
                 d + ((6 - EXTRACT(ISODOW FROM d)::int + 7) % 7),
                 'YYYY-MM-DD'
               ) AS day
          FROM (SELECT ((now() AT TIME ZONE 'Asia/Manila')::date - 63) AS d) AS s
      `.execute(db);

      return result.rows[0].day;
    }

    const amend = (body: Record<string, unknown>, as: TestAccount, date: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/cells/${markCell.id}/meetings/${date}/submit`)
        .set('Authorization', `Bearer ${as.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(body);

    it('refuses a closed month without the flag, for an Admin too', async () => {
      // Section 13 asks for exactly this, so "a retry that happens to arrive after the
      // 7th never rewrites a closed period by accident". Holding the capability is not
      // enough on its own — the request has to say it means to amend.
      const one = await member('Aurelio');
      const admin = await adminAccount();
      const closed = await closedMonthSaturday();

      const response = await amend(
        { status: 'HELD', attendance: [{ person_id: one.id, present: true }] },
        admin,
        closed,
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('PERIOD_CLOSED');
    });

    it('records into a closed month with the flag and the capability', async () => {
      const one = await member('Aurelio');
      const admin = await adminAccount();
      const closed = await closedMonthSaturday();

      const response = await amend(
        {
          status: 'HELD',
          attendance: [{ person_id: one.id, present: true }],
          amendment: { reason: 'Paper register found after the window shut.' },
        },
        admin,
        closed,
      );

      expect(response.status).toBe(201);
      expect(response.body.recorded).toBe(1);

      // Section 13 requires it audited, and a first submission writes no entry of its
      // own — so without this action the month would be rewritten with nothing logged.
      const entries = await db
        .selectFrom('audit_log')
        .select(['action', 'reason', 'target_id'])
        .where('action', '=', 'cell_attendance.amended')
        .execute();

      expect(entries).toHaveLength(1);
      expect(entries[0].reason).toBe('Paper register found after the window shut.');
      expect(entries[0].target_id).toBe(markCell.id);
    });

    it('audits an amendment that corrects a record, not only one that creates it', async () => {
      // **The ordinary case, and it was the unaudited one.** A closed month usually
      // already holds records, so amending it is normally a *correction* — and the entry
      // sat inside the first-submission branch, unreachable once `correctWithin` took
      // over. The month was rewritten, 201 with `corrected: 1`, and nothing in the log
      // said an amendment had happened or why. `cell_attendance.corrected` carries
      // `correction_reason`, a different field, which was null here.
      const one = await member('Aurelio');
      const admin = await adminAccount();
      const closed = await closedMonthSaturday();

      await amend(
        {
          status: 'HELD',
          attendance: [{ person_id: one.id, present: true }],
          amendment: { reason: 'First amendment, creates the record.' },
        },
        admin,
        closed,
      ).expect(201);

      const second = await amend(
        {
          status: 'HELD',
          version: 1,
          attendance: [{ person_id: one.id, present: false }],
          amendment: { reason: 'Second amendment, corrects it.' },
        },
        admin,
        closed,
      );

      expect(second.status).toBe(201);
      expect(second.body.corrected).toBe(1);

      const entries = await db
        .selectFrom('audit_log')
        .select(['reason', 'target_id'])
        .where('action', '=', 'cell_attendance.amended')
        .orderBy('occurred_at')
        .execute();

      expect(entries).toHaveLength(2);
      expect(entries[1].reason).toBe('Second amendment, corrects it.');
      expect(entries[1].target_id).toBe(markCell.id);
    });

    it('treats an explicit null amendment as absent, in both directions', async () => {
      // `@IsOptional()` passes an explicit null through untouched and skips every other
      // decorator, so `!== undefined` was true of it: a closed month dereferenced null
      // and answered 500 on a well-formed body, and an open month refused an ordinary
      // submission that amends nothing. Null and absent mean one thing here.
      const one = await member('Aurelio');
      const admin = await adminAccount();
      const closed = await closedMonthSaturday();

      const onClosed = await amend(
        {
          status: 'HELD',
          attendance: [{ person_id: one.id, present: true }],
          amendment: null,
        },
        admin,
        closed,
      );

      expect(onClosed.status).toBe(409);
      expect(onClosed.body.error.code).toBe('PERIOD_CLOSED');

      const onOpen = await amend(
        {
          status: 'HELD',
          attendance: [{ person_id: one.id, present: true }],
          amendment: null,
        },
        admin,
        meetingDate,
      );

      expect(onOpen.status).toBe(201);
    });

    it('still refuses a meeting outside the amender’s scope', async () => {
      // **The flag widens *when*, never *whose*** (section 13). Everything below the
      // window check still runs, and this pins the half that is easiest to lose: an
      // actor holding the backdate capability but no scope over the meeting is refused
      // exactly as they would be inside an open month.
      //
      // **An `ADMIN` will not do**, and the first version of this case used one: section 7
      // gives that role `cell.take_attendance` at Whole Church, so an Admin reaches every
      // Cell and the case answered 201. The actor this rule is about holds the backdate
      // capability at Whole Church — it is `WHOLE_CHURCH_ONLY` — and the recording
      // capability only over their own subtree, which does not contain Mark.
      const one = await member('Aurelio');
      const closed = await closedMonthSaturday();
      const granter = await adminAccount();

      const ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
      await assignTo(db, ben.id, root.id);
      const outsider = await createAccount(app, db, { person: ben, roles: [] });

      for (const grant of [
        { capability: 'cell.take_attendance', scope_type: 'OWN_SUBTREE' },
        { capability: 'records.backdate_effective_date', scope_type: 'WHOLE_CHURCH' },
      ] as const) {
        await db
          .insertInto('capability_grants')
          .values({
            account_id: outsider.id,
            capability: grant.capability as never,
            scope_type: grant.scope_type,
            read_only: false,
            reason: 'Invented for this case (CLAUDE.md, Secrets).',
            granted_by: granter.id,
          })
          .execute();
      }

      const response = await amend(
        {
          status: 'HELD',
          attendance: [{ person_id: one.id, present: true }],
          amendment: { reason: 'Holding the capability is not holding the scope.' },
        },
        outsider,
        closed,
      );

      expect(response.status).toBe(403);

      const rows = await db
        .selectFrom('cell_meetings')
        .select('id')
        .where('cell_id', '=', markCell.id)
        .execute();

      expect(rows).toHaveLength(0);
    });

    it('writes no entry for an amendment that corrects nothing', async () => {
      // Section 9 settles it and section 21 states the rule: "an unchanged line is not an
      // amendment", and the log carries one entry per action *performed*. Resubmitting an
      // identical roster corrects nothing — and wrote a second entry whose `after` was
      // byte-identical to the first, asserting an amendment section 7 says is not one.
      const one = await member('Aurelio');
      const admin = await adminAccount();
      const closed = await closedMonthSaturday();

      const body = {
        status: 'HELD',
        attendance: [{ person_id: one.id, present: true }],
      };

      await amend({ ...body, amendment: { reason: 'Creates the record.' } }, admin, closed).expect(
        201,
      );

      const again = await amend(
        { ...body, version: 1, amendment: { reason: 'Changes nothing at all.' } },
        admin,
        closed,
      );

      expect(again.status).toBe(201);
      expect(again.body.corrected).toBe(0);

      const entries = await db
        .selectFrom('audit_log')
        .select('reason')
        .where('action', '=', 'cell_attendance.amended')
        .execute();

      expect(entries).toHaveLength(1);
      expect(entries[0].reason).toBe('Creates the record.');
    });

    it('refuses a blank reason, which is a reason nobody supplied', async () => {
      const one = await member('Aurelio');
      const admin = await adminAccount();
      const closed = await closedMonthSaturday();

      const response = await amend(
        {
          status: 'HELD',
          attendance: [{ person_id: one.id, present: true }],
          amendment: { reason: '' },
        },
        admin,
        closed,
      );

      expect(response.status).toBe(422);

      // And whitespace is blank too — `@MinLength(1)` was the first fix and let this
      // through, which is the same hole one space wider.
      const spaces = await amend(
        {
          status: 'HELD',
          attendance: [{ person_id: one.id, present: true }],
          amendment: { reason: '   ' },
        },
        admin,
        closed,
      );

      expect(spaces.status).toBe(422);
    });

    it('refuses the flag from an actor without records.backdate_effective_date', async () => {
      // The capability is required *in addition to* `cell.take_attendance`, so an
      // amendment widens when and never what or whose. Mark leads the Cell and may
      // record it; he is not an Admin.
      const one = await member('Aurelio');
      const closed = await closedMonthSaturday();

      const response = await amend(
        {
          status: 'HELD',
          attendance: [{ person_id: one.id, present: true }],
          amendment: { reason: 'Trying to reach past the window.' },
        },
        markAccount,
        closed,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.details.capability).toBe('records.backdate_effective_date');
    });

    it('refuses the flag on a month that is still open', async () => {
      // Not an operation section 13 defines, and refused rather than ignored: section
      // 22's versioning rule makes a field accepted and ignored impossible to give
      // meaning to later.
      const one = await member('Aurelio');
      const admin = await adminAccount();

      const response = await amend(
        {
          status: 'HELD',
          attendance: [{ person_id: one.id, present: true }],
          amendment: { reason: 'Nothing to amend.' },
        },
        admin,
        meetingDate,
      );

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });
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

  describe('two first submissions racing (section 22, *Write conflicts*)', () => {
    const liveRows = () =>
      db
        .selectFrom('cell_attendance')
        .select(['person_id', 'present', 'version', 'id'])
        .where('superseded_at', 'is', null)
        .execute();

    /**
     * The winner, written on a second connection and left uncommitted.
     *
     * **A holder rather than two requests fired together.** Two API requests serialise:
     * the loser re-reads a committed meeting, takes the ordinary "second submission"
     * path, and never meets the index at all — which is how a case for this branch went
     * green against the code it was written to refuse. What the branch needs is a writer
     * that holds `(cell_id, scheduled_date)` and commits only once the request is
     * provably blocked on it.
     *
     * `attendance` is written inside the same transaction so the loser's re-read sees a
     * roster to compare against, which is what decides `RESOURCE_BUSY` from
     * `VERSION_CONFLICT`.
     */
    async function winnerHolding(
      attendance: { personId: string; present: boolean }[],
    ): Promise<Client> {
      const schedule = await db
        .selectFrom('cell_schedules')
        .select('time_of_day')
        .where('cell_id', '=', markCell.id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();

      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      await holder.query('BEGIN');

      // `week_starting` and `reporting_month` derived in SQL from the meeting's own date,
      // so this fixture cannot disagree with the service about which week or month the
      // meeting belongs to (sections 13 and 20).
      const { rows } = await holder.query<{ id: string }>(
        `INSERT INTO cell_meetings
           (cell_id, scheduled_date, scheduled_time, week_starting, reporting_month,
            status, responsible_leader_id, submitted_by, submitted_at, version)
         VALUES ($1, $2::date, $3::time,
                 $2::date - (EXTRACT(ISODOW FROM $2::date)::int - 1),
                 date_trunc('month', $2::date)::date,
                 'HELD', $4, $5, clock_timestamp(), 1)
         RETURNING id`,
        [markCell.id, meetingDate, schedule.time_of_day, mark.id, markAccount.id],
      );

      for (const line of attendance) {
        await holder.query(
          `INSERT INTO cell_attendance
             (cell_meeting_id, person_id, present, recorded_by, recorded_at, version)
           VALUES ($1, $2, $3, $4, clock_timestamp(), 1)`,
          [rows[0].id, line.personId, line.present, markAccount.id],
        );
      }

      return holder;
    }

    /** Blocks until the request is provably waiting on a lock, bounded by the request. */
    async function blockedOn(holder: Client, inFlight: ReturnType<typeof track>): Promise<number> {
      // **`pg_blocking_pids`, not a `pg_locks` count**, on the reasoning the correction
      // race above states: a cluster-wide count of ungranted locks names neither the
      // waiter nor what it waits on, `CLAUDE.md` records an orphaned jest process against
      // `dfc_ci` as a live occurrence, and a `transactionid` row carries no database to
      // filter on. `test/setup/concurrency.ts` gives the direction of harm — these probes
      // assert a waiter *appears*, so a false positive passes a case that should have
      // failed. It would have, here and asymmetrically: with a premature commit the
      // conflict case still answers 409 through the correction path, which is not the
      // code it exists to test, while only the `RESOURCE_BUSY` case reddens.
      const holderPid = Number(
        (await holder.query<{ pid: string }>('SELECT pg_backend_pid() AS pid')).rows[0].pid,
      );

      return countWhileInFlight(
        async () => {
          const blocked = await sql<{ count: string }>`
            SELECT count(*) AS count
              FROM pg_stat_activity
             WHERE ${sql.lit(holderPid)} = ANY (pg_blocking_pids(pid))
          `.execute(db);

          return Number(blocked.rows[0].count);
        },
        inFlight,
        'the first submission to block on cell_meetings_one_per_scheduled_date',
      );
    }

    it('answers the loser a conflict with a null submitted version, not a 500', async () => {
      // `docs/ROADMAP.md` makes this Stage 4's "Done when": a concurrent double
      // submission produces a conflict rather than a silent overwrite. Section 22 names
      // this as one of exactly two cases carrying a null `submitted_version` — "Two first
      // submissions of one meeting race, and the loser meets the uniqueness of
      // `(cell_id, scheduled_date)`" — and says a uniqueness violation "left to surface
      // on its own is an `INTERNAL_ERROR` on an ordinary race", which is what this was.
      const one = await member('Aurelio');
      const holder = await winnerHolding([{ personId: one.id, present: true }]);

      try {
        // The loser disagrees with the winner: absent against present.
        const attempt = submit({
          status: 'HELD',
          attendance: [{ person_id: one.id, present: false }],
        });
        const inFlight = track(attempt);

        expect(await blockedOn(holder, inFlight)).toBeGreaterThan(0);

        await holder.query('COMMIT');

        const response = await attempt;

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('VERSION_CONFLICT');
        // Neither writer held a version, because there was nothing to have read.
        expect(response.body.error.details.submitted_version).toBeNull();
        expect(response.body.error.details.current_version).toBe(1);

        // The winner's record stands alone and was not overwritten.
        const live = await liveRows();
        expect(live).toHaveLength(1);
        expect(live[0].person_id).toBe(one.id);
        expect(live[0].present).toBe(true);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });

    it('refuses the conflict payload to an actor who may record but not correct', async () => {
      // **`lostRaceAnswer` was written downstream of `assertMayCorrect` and the new caller
      // skipped it** (decision 0100: reusing a shape requires re-deriving why it has that
      // shape). A `VERSION_CONFLICT` carries the stored present count and the submitter's
      // name, which `GET .../roster` does not — so this actor read the record out of a
      // lost race, having been refused 403 for the identical body sent sequentially.
      // Timing decided which answer they got.
      const one = await member('Aurelio');
      const actor = await granted(['cell.take_attendance', 'cell.submit_on_behalf']);
      const holder = await winnerHolding([{ personId: one.id, present: true }]);

      try {
        const attempt = submit(
          { status: 'HELD', attendance: [{ person_id: one.id, present: false }] },
          actor,
        );
        const inFlight = track(attempt);

        expect(await blockedOn(holder, inFlight)).toBeGreaterThan(0);

        await holder.query('COMMIT');

        const response = await attempt;

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('SCOPE_DENIED');
        expect(response.body.error.details.capability).toBe('cell.correct_subtree');
        // And nothing of the stored record came back with the refusal.
        expect(JSON.stringify(response.body)).not.toContain('present');
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });

    it('asks no correction capability of an agreeing loser, which wrote nothing', async () => {
      // **The mirror of the case above, and the first fix introduced it.** Checking the
      // amendment capability before the comparison refused this actor 403 where the
      // identical body sent sequentially answers 201 with `corrected: 0` — so timing
      // still decided the answer, in the opposite direction. Section 7: "A write that
      // writes nothing owes no *amendment* capability."
      //
      // **And the idempotency key made it permanent.** Section 22 stores a 4xx against
      // the key and releases a 5xx, so a conforming client retrying the unchanged body on
      // the same key replayed the 403 for ever, while `RESOURCE_BUSY` is a 503 and frees
      // it. That is why this is asserted with one key held across the retry.
      const one = await member('Aurelio');
      const actor = await granted(['cell.take_attendance', 'cell.submit_on_behalf']);
      const holder = await winnerHolding([{ personId: one.id, present: true }]);
      const key = randomUUID();

      try {
        const attempt = request(app.getHttpServer())
          .post(`/api/v1/cells/${markCell.id}/meetings/${meetingDate}/submit`)
          .set('Authorization', `Bearer ${actor.accessToken}`)
          .set('Idempotency-Key', key)
          .send({ status: 'HELD', attendance: [{ person_id: one.id, present: true }] });
        const inFlight = track(attempt);

        expect(await blockedOn(holder, inFlight)).toBeGreaterThan(0);

        await holder.query('COMMIT');

        const response = await attempt;

        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('RESOURCE_BUSY');

        // The retry the code names, on the same key, actually succeeds — which is what
        // `RESOURCE_BUSY` means and what a stored 403 would have made impossible.
        const retry = await request(app.getHttpServer())
          .post(`/api/v1/cells/${markCell.id}/meetings/${meetingDate}/submit`)
          .set('Authorization', `Bearer ${actor.accessToken}`)
          .set('Idempotency-Key', key)
          .send({ status: 'HELD', attendance: [{ person_id: one.id, present: true }] });

        expect(retry.status).toBe(201);
        expect(retry.body.corrected).toBe(0);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });

    it('refuses a status disagreement instead of prescribing a retry that cannot succeed', async () => {
      // **`disagrees` is vacuously false over an empty roster.** A `NOT_HELD` body carries
      // no attendance by construction, so `some` was false whatever the winner recorded,
      // and the loser was told `RESOURCE_BUSY` — which section 22 defines as "the
      // identical body resubmitted succeeds, writing nothing". It does not: section 13
      // makes a status change a separate operation, so the retry is refused permanently.
      // Decision 0158 fixes the test as one question, and the answer here was no.
      //
      // This is the same shape `correctWithin` already guards against, and says so where
      // it does it.
      const one = await member('Aurelio');
      const holder = await winnerHolding([{ personId: one.id, present: true }]);

      try {
        const attempt = submit({
          status: 'NOT_HELD',
          not_held_reason: 'LEADER_UNAVAILABLE',
        });
        const inFlight = track(attempt);

        expect(await blockedOn(holder, inFlight)).toBeGreaterThan(0);

        await holder.query('COMMIT');

        const response = await attempt;

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
        expect(response.body.error.details.current_status).toBe('HELD');

        // The answer is the one the same body gets sequentially, which is the property
        // that makes it right: timing no longer decides.
        const sequential = await submit({
          status: 'NOT_HELD',
          not_held_reason: 'LEADER_UNAVAILABLE',
        });

        expect(sequential.status).toBe(409);
        expect(sequential.body.error.code).toBe('INVARIANT_VIOLATION');
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });

    it('answers RESOURCE_BUSY when the winner recorded what the loser was carrying', async () => {
      // Section 22's other outcome, over the same race: the loser re-reads and finds it
      // agrees, so there is nothing to choose between and a conflict would present two
      // identical values. The identical body resubmitted then succeeds writing nothing,
      // which is what that code means.
      const one = await member('Aurelio');
      const holder = await winnerHolding([{ personId: one.id, present: true }]);

      try {
        const attempt = submit({
          status: 'HELD',
          attendance: [{ person_id: one.id, present: true }],
        });
        const inFlight = track(attempt);

        expect(await blockedOn(holder, inFlight)).toBeGreaterThan(0);

        await holder.query('COMMIT');

        const response = await attempt;

        // 503, not 409, and deliberately so (decision 0095): the retry is the remedy,
        // and a conflict would present two identical values.
        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('RESOURCE_BUSY');

        // And the retry it names actually succeeds, writing nothing further.
        const retry = await submit({
          status: 'HELD',
          attendance: [{ person_id: one.id, present: true }],
        });

        expect(retry.status).toBe(201);

        const live = await liveRows();
        expect(live).toHaveLength(1);
        expect(live[0].present).toBe(true);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });
  });
});
