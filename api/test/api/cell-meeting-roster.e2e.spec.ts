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
});
