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
 * `GET /api/v1/cells/{id}/meetings/{meeting_id}/roster` (SKILL.md sections 12 and 13).
 *
 * **Who there is to record, at the date the meeting took place.** Section 12: "The
 * roster for a meeting is exactly the people holding an active membership of that Cell
 * on the meeting date", and where the meeting was rescheduled it is taken from "the
 * actual date the meeting took place, not the date it was originally scheduled for".
 * Section 13 requires the responsible leader to be read at that same instant — "the
 * leader and the people are read at one instant rather than two".
 *
 * The Cell meets on Saturdays. September 2026 holds four (5, 12, 19, 26).
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('a Cell meeting roster (sections 12 and 13)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let root: TestPerson;
  let mark: TestPerson;
  let markCell: TestCell;
  let markAccount: TestAccount;
  let stranger: TestAccount;

  const CREATED = new Date('2026-01-03T10:00:00+08:00');

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

    const other = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    await assignTo(db, other.id, root.id);
    stranger = await createAccount(app, db, { person: other, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  const roster = (cellId: string, meetingId: string, as: TestAccount) =>
    request(app.getHttpServer())
      .get(`/api/v1/cells/${cellId}/meetings/${meetingId}/roster`)
      .set('Authorization', `Bearer ${as.accessToken}`);

  /** A member of Mark's Cell over `[from, to)`, by their first name. */
  async function member(
    firstName: string,
    from: Date,
    to: Date | null = null,
  ): Promise<TestPerson> {
    const person = await createPerson(db, { firstName, network: 'MENS' });
    await assignTo(db, person.id, mark.id);
    await db
      .insertInto('cell_memberships')
      .values({
        person_id: person.id,
        cell_id: markCell.id,
        started_at: from,
        ended_at: to,
      })
      .execute();

    return person;
  }

  it('lists the members who held a membership on the meeting date', async () => {
    const inside = await member('Aurelio', new Date('2026-08-01T10:00:00+08:00'));
    // Joined after the meeting, so not in the room.
    await member('Bartolome', new Date('2026-09-20T10:00:00+08:00'));
    // Left before it.
    await member(
      'Crisanto',
      new Date('2026-02-01T10:00:00+08:00'),
      new Date('2026-08-01T10:00:00+08:00'),
    );

    const response = await roster(markCell.id, '2026-09-12', markAccount);

    expect(response.status).toBe(200);
    expect(response.body.roster_date).toBe('2026-09-12');
    expect(response.body.responsible_leader_id).toBe(mark.id);
    expect(response.body.members.map((m: { person_id: string }) => m.person_id)).toEqual([
      inside.id,
    ]);
  });

  it('takes the roster from the actual date where the meeting moved', async () => {
    // Section 12: "Membership can change between the two, and the roster should be the
    // people who could actually have been there." Joined on the 15th: absent from the
    // Cell on the 12th, present when the meeting actually happened on the 19th.
    const late = await member('Domingo', new Date('2026-09-15T10:00:00+08:00'));

    await db
      .insertInto('cell_meetings')
      .values({
        cell_id: markCell.id,
        scheduled_date: '2026-09-12',
        scheduled_time: '19:00',
        week_starting: '2026-09-07',
        reporting_month: '2026-09-01',
        status: 'RESCHEDULED',
        actual_date: '2026-09-19',
        actual_time: '19:00',
        responsible_leader_id: mark.id,
      } as never)
      .execute();

    const response = await roster(markCell.id, '2026-09-12', markAccount);

    expect(response.body.roster_date).toBe('2026-09-19');
    expect(response.body.meeting.status).toBe('RESCHEDULED');
    expect(response.body.members.map((m: { person_id: string }) => m.person_id)).toContain(late.id);
  });

  it('hands over the status, version and submitter that section 7 says it does', async () => {
    // **The other half of section 7's ordering argument, and it was unpinned.** Section 7
    // permits the submit route to read the meeting row and refuse a status change before
    // deciding the on-behalf capability, on the ground that what such a refusal exposes --
    // the meeting's own status, version and submitter -- is handed to the same actor by
    // this route anyway. `capability-scope-resolution.spec.ts` pins that the two routes
    // carry the identical declaration; nothing pinned that this one actually returns those
    // three fields. Redact any of them and the specification's justification quietly
    // becomes false with both decorators still identical.
    //
    // Read as the meeting's own leader holding `cell.take_attendance` -- the actor the
    // argument is about, since an actor holding the correction capability could read the
    // record out of a `VERSION_CONFLICT` regardless.
    await db
      .insertInto('cell_meetings')
      .values({
        cell_id: markCell.id,
        scheduled_date: '2026-09-12',
        scheduled_time: '19:00',
        week_starting: '2026-09-07',
        reporting_month: '2026-09-01',
        status: 'HELD',
        responsible_leader_id: mark.id,
        // `submitted_by` references `accounts`, not `persons` (migration 0011), and the
        // roster returns the stored value unchanged.
        submitted_by: markAccount.id,
        submitted_at: new Date('2026-09-12T21:00:00+08:00'),
        version: 1,
      } as never)
      .execute();

    const response = await roster(markCell.id, '2026-09-12', markAccount);

    expect(response.status).toBe(200);
    expect(response.body.meeting).toMatchObject({
      status: 'HELD',
      version: 1,
      submitted_by: markAccount.id,
      // **In the matcher, because the obvious assertion cannot fail.** This read
      // `expect(response.body.meeting.submitted_at).not.toBeNull()`, and
      // `expect(undefined).not.toBeNull()` passes — so redacting the field reddened
      // nothing. `toMatchObject` fails on an absent key, which is what pins it.
      submitted_at: expect.any(String),
    });
    expect(new Date(response.body.meeting.submitted_at as string).getTime()).toBe(
      new Date('2026-09-12T21:00:00+08:00').getTime(),
    );
  });

  it('keeps the meeting in its own reporting month whatever the roster date', async () => {
    // The reschedule moves the roster and never the period (sections 12 and 13).
    await db
      .insertInto('cell_meetings')
      .values({
        cell_id: markCell.id,
        scheduled_date: '2026-09-26',
        scheduled_time: '19:00',
        week_starting: '2026-09-21',
        reporting_month: '2026-09-01',
        status: 'RESCHEDULED',
        actual_date: '2026-10-03',
        actual_time: '19:00',
        responsible_leader_id: mark.id,
      } as never)
      .execute();

    const response = await roster(markCell.id, '2026-09-26', markAccount);

    expect(response.body.reporting_month).toBe('2026-09-01');
    expect(response.body.roster_date).toBe('2026-10-03');
  });

  it('refuses a date the Cell was not scheduled to meet on', async () => {
    // Section 13 identifies a meeting by `(cell_id, scheduled_date)` and derives the
    // scheduled set from the schedule. A Wednesday names no meeting, and answering one
    // would invent a meeting the coverage denominator does not count.
    const response = await roster(markCell.id, '2026-09-09', markAccount);

    expect(response.status).toBe(404);
  });

  it('refuses a caller who cannot reach the Cell', async () => {
    const response = await roster(markCell.id, '2026-09-12', stranger);

    expect(response.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // The recorded marks (decision 0223)
  // ---------------------------------------------------------------------------

  describe('the marks it asks to be resubmitted', () => {
    /** A `HELD` meeting on 12 September, with the given marks already recorded. */
    async function recordMeeting(marks: { person: TestPerson; present: boolean }[]): Promise<void> {
      const meeting = await db
        .insertInto('cell_meetings')
        .values({
          cell_id: markCell.id,
          scheduled_date: '2026-09-12',
          scheduled_time: '19:00',
          week_starting: '2026-09-07',
          reporting_month: '2026-09-01',
          status: 'HELD',
          responsible_leader_id: mark.id,
          submitted_by: markAccount.id,
          submitted_at: new Date(),
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow();

      for (const mark_ of marks) {
        await db
          .insertInto('cell_attendance')
          .values({
            cell_meeting_id: meeting.id,
            person_id: mark_.person.id,
            present: mark_.present,
            recorded_by: markAccount.id,
          })
          .execute();
      }
    }

    it('carries each member’s mark, present and absent alike', async () => {
      // **A nullable object rather than a boolean that defaults to false**, because a
      // correction screen rendering `present: false` for a member who has no row would
      // resubmit them absent — the data loss decision 0223 exists to prevent, arriving
      // through the field added to prevent it. *An earlier version credited section 20
      // with needing the two to be different facts; it says nothing of the kind, and
      // both contribute identically to every figure the system computes.*
      const attended = await member('Aaron', CREATED);
      const missed = await member('Bea', CREATED);

      await recordMeeting([
        { person: attended, present: true },
        { person: missed, present: false },
      ]);

      const response = await roster(markCell.id, '2026-09-12', markAccount);
      const lines = response.body.members as { person_id: string; record: unknown }[];

      expect(lines.find((line) => line.person_id === attended.id)?.record).toEqual({
        present: true,
      });
      expect(lines.find((line) => line.person_id === missed.id)?.record).toEqual({
        present: false,
      });
    });

    it('carries null for a member with no record', async () => {
      const recorded = await member('Aaron', CREATED);
      const unrecorded = await member('Bea', CREATED);

      await recordMeeting([{ person: recorded, present: true }]);

      const response = await roster(markCell.id, '2026-09-12', markAccount);
      const lines = response.body.members as { person_id: string; record: unknown }[];

      expect(lines.find((line) => line.person_id === unrecorded.id)?.record).toBeNull();
    });

    it('carries null on a meeting nobody has recorded yet', async () => {
      // The ordinary first submission: section 13 gives a meeting no row until it is
      // reported, so there is nothing to show and the field is present and null rather
      // than absent.
      await member('Aaron', CREATED);

      const response = await roster(markCell.id, '2026-09-12', markAccount);

      expect(response.body.meeting).toBeNull();
      expect((response.body.members as { record: unknown }[])[0].record).toBeNull();
    });

    it('carries null where a member’s only record was closed with nothing replacing it', async () => {
      // **The deterministic case, and the reason the obvious one is not.** A correction
      // supersedes rather than overwrites (section 14), and a member whose row was
      // *replaced* has a live row either way — a test asserting the successor's value
      // passes against a service reading both rows, because the map it builds happens to
      // take the later one. A record closed with **nothing** replacing it leaves the
      // member with no live row at all, so the filter is the only thing that can produce
      // the null.
      //
      // Section 13 makes that a real state rather than a contrivance: decision 0183
      // settles that such a record names itself as its own successor, and migration 0013
      // exempts `cell_attendance` from the self-reference refusal for exactly this.
      const withdrawn = await member('Aaron', CREATED);
      await recordMeeting([{ person: withdrawn, present: true }]);

      const row = await db
        .selectFrom('cell_attendance')
        .select('id')
        .where('person_id', '=', withdrawn.id)
        .executeTakeFirstOrThrow();

      await db
        .updateTable('cell_attendance')
        .set({ superseded_at: sql<Date>`clock_timestamp()`, superseded_by: row.id })
        .where('id', '=', row.id)
        .execute();

      const response = await roster(markCell.id, '2026-09-12', markAccount);
      const lines = response.body.members as { person_id: string; record: unknown }[];

      expect(lines.find((line) => line.person_id === withdrawn.id)?.record).toBeNull();
    });

    it('carries no per-person version', async () => {
      // **The part a copy of the DCC roster would have got wrong.** Decision 0164 has a
      // Cell submission carry *the meeting's* version, and decision 0190 states that
      // `cell_attendance.version` orders one person's chain and is not compared — so a
      // per-person version here would be a number the client must not send back, offered
      // beside the fields it must. The version a correction carries is on `meeting`.
      const attended = await member('Aaron', CREATED);
      await recordMeeting([{ person: attended, present: true }]);

      const response = await roster(markCell.id, '2026-09-12', markAccount);
      const line = (response.body.members as { record: Record<string, unknown> }[])[0];

      expect(Object.keys(line.record)).toEqual(['present']);
      expect(response.body.meeting.version).toBe(1);
    });
  });
});
