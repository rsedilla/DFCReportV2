import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { sql } from 'kysely';

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
 * `GET /api/v1/cells/meetings/awaiting` — section 19's recording queue (ruling of
 * 2026-09-17).
 *
 * **The case this route exists for is the closed Cell.** Section 19 says its meetings
 * are shown to the leader they name while the month's window is open, and calls that
 * queue "the only surface naming those meetings and the only thing that makes the
 * permission to record them reachable". Before this route the Dashboard assembled the
 * queue from the `ACTIVE`-only Cells index, so a Cell closed part-way through a month
 * took its already-scheduled meetings out of reach with it.
 *
 * **Every expectation is computed from the database's own clock rather than written
 * down.** The population is bounded by two moving things — the month's submission
 * window and whether a day has begun — so a case with hardcoded dates passes for a few
 * weeks and then reports a defect that is the calendar. The meeting dates are
 * enumerated here by the same rule the route derives them by, which is a second
 * transcription rather than a second source: if the two disagree the case fails, which
 * is the point.
 *
 * **The weekday the Cell meets on is chosen by {@link stage} rather than fixed, and
 * fixing it was a defect.** These cases first met on Saturdays and asserted that some
 * Saturday of the current month had already elapsed. That is false for up to six days
 * of any month beginning on a Sunday — 1 to 6 November 2026 is the next — so four
 * cases would have gone red on the calendar rather than on the code, in a suite
 * `CLAUDE.md` requires to stay green. A case that cannot be staged must not be a
 * failure, and skipping it silently is worse; so the fixture is staged to fit the
 * calendar instead of asserting the calendar fits the fixture.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('the recording queue (sections 13 and 19)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let root: TestPerson;
  let mark: TestPerson;
  let markAccount: TestAccount;
  let ben: TestPerson;
  let benAccount: TestAccount;

  /** The Manila date the database is currently on, as `YYYY-MM-DD`. */
  const manilaToday = async (): Promise<string> => {
    const result = await sql<{ today: string }>`
      SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
    `.execute(db);

    return result.rows[0].today;
  };

  const pad = (value: number): string => String(value).padStart(2, '0');

  /** Every day of one month falling on `dayOfWeek`, up to and including `through`. */
  const daysFalling = (
    year: number,
    month: number,
    through: number,
    dayOfWeek: number,
  ): string[] => {
    const dates: string[] = [];

    for (let d = 1; d <= through; d += 1) {
      // Date.UTC, so the weekday is not the runner's local one.
      const at = new Date(Date.UTC(year, month - 1, d));
      // getUTCDay is 0 for Sunday; ISO 8601 makes it 7, and 7 % 7 is 0.
      if (at.getUTCDay() === dayOfWeek % 7) {
        dates.push(`${year}-${pad(month)}-${pad(d)}`);
      }
    }

    return dates;
  };

  /**
   * An open month, a weekday of it, and the `count` or more meeting dates that follow —
   * every one of them a day that has already begun in Manila.
   *
   * **The current month is preferred, and the close week is why it is not the only
   * candidate.** In a month's first seven days no weekday has come round twice, so a
   * case needing two meetings cannot be staged there at all. Section 13 keeps last
   * month open through the 7th and every one of its days has begun, which is exactly
   * the complement: outside the close week the current month carries two by its 8th,
   * and inside it last month carries four or five.
   *
   * The Cell is created at the start of the year before, so the schedule is in force
   * across the whole of whichever month is chosen.
   */
  const stage = async (
    count: number,
  ): Promise<{ month: string; dayOfWeek: number; dates: string[]; created: Date }> => {
    const today = await manilaToday();
    const [year, month, day] = today.split('-').map(Number);

    const candidates = [{ year, month, through: day }];

    if (day <= 7) {
      const previous = new Date(Date.UTC(year, month - 2, 1));
      const previousYear = previous.getUTCFullYear();
      const previousMonth = previous.getUTCMonth() + 1;

      candidates.push({
        year: previousYear,
        month: previousMonth,
        // Day 0 of the next month is the last day of this one.
        through: new Date(Date.UTC(previousYear, previousMonth, 0)).getUTCDate(),
      });
    }

    for (const candidate of candidates) {
      for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek += 1) {
        const dates = daysFalling(candidate.year, candidate.month, candidate.through, dayOfWeek);

        if (dates.length >= count) {
          return {
            month: `${candidate.year}-${pad(candidate.month)}-01`,
            dayOfWeek,
            dates,
            created: new Date(Date.UTC(candidate.year - 1, 0, 1, 2)),
          };
        }
      }
    }

    throw new Error(`no open month carries ${count} elapsed meetings falling on one weekday`);
  };

  /** An instant on a given Manila day, late enough to be after that day's meeting. */
  const manilaEndOf = (date: string): Date => new Date(`${date}T23:30:00+08:00`);

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
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    await assignTo(db, ben.id, root.id);
    benAccount = await createAccount(app, db, { person: ben, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  const queue = (month: string, as: TestAccount) =>
    request(app.getHttpServer())
      .get('/api/v1/cells/meetings/awaiting')
      .query({ month })
      .set('Authorization', `Bearer ${as.accessToken}`);

  const datesIn = (body: { meetings: { scheduled_date: string }[] }): string[] =>
    body.meetings.map((m) => m.scheduled_date);

  /** Hand a Cell from its current leader to `to`, at an instant. */
  const handOver = async (cell: TestCell, to: TestPerson, at: Date): Promise<void> => {
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cell_leaderships')
        .set({ ended_at: at })
        .where('cell_id', '=', cell.id)
        .where('ended_at', 'is', null)
        .execute();

      await trx
        .insertInto('cell_leaderships')
        .values({ person_id: to.id, cell_id: cell.id, started_at: at })
        .execute();
    });
  };

  it('lists the meetings of the current month whose day has begun, and no others', async () => {
    // `stage(1)` always answers the current month: the weekday of its first day has
    // come round at least once by definition, whatever day of the month it is.
    const { month, dayOfWeek, dates, created } = await stage(1);
    await createCell(db, { leader: mark, dayOfWeek, createdAt: created });

    const today = await manilaToday();
    expect(month).toBe(`${today.slice(0, 8)}01`);

    const response = await queue(month, markAccount);

    expect(response.status).toBe(200);
    expect(response.body.open).toBe(true);
    // Decision 0238: a meeting whose Manila day has not begun takes no record, so it
    // carries no act that resolves it and section 19 says an entry must never be that.
    expect(datesIn(response.body)).toEqual(dates);
    expect(datesIn(response.body).every((date) => date <= today)).toBe(true);
  });

  it('names a closed Cell’s meetings, which no other surface can', async () => {
    const { month, dayOfWeek, dates, created } = await stage(1);
    const cell = await createCell(db, { leader: mark, dayOfWeek, createdAt: created });

    // Closed the evening of its most recent meeting: every earlier Saturday is still
    // owed, and the Cell is gone from the `ACTIVE`-only index that fed the Dashboard.
    await closeCellDirectly(db, cell.id, {
      reason: 'MEMBERS_DISPERSED',
      at: manilaEndOf(dates[dates.length - 1]),
    });

    const response = await queue(month, markAccount);

    expect(response.status).toBe(200);
    expect(datesIn(response.body)).toEqual(dates);
  });

  it('gives an ACTIVE Cell’s meeting to the leader who holds it now, not the one who held it then', async () => {
    const { month, dayOfWeek, dates, created } = await stage(1);
    const cell = await createCell(db, { leader: mark, dayOfWeek, createdAt: created });

    // Handed to Ben after the month's meetings so far. Section 7: "An `ACTIVE` Cell is
    // untouched by this and resolves through its current leader, whatever any record
    // says" — so Ben files them, and showing them to Mark would offer him a button the
    // submission route refuses while hiding the task from the leader who owes it.
    await handOver(cell, ben, manilaEndOf(dates[dates.length - 1]));

    const forBen = await queue(month, benAccount);
    expect(forBen.status).toBe(200);
    expect(datesIn(forBen.body)).toEqual(dates);

    const forMark = await queue(month, markAccount);
    expect(forMark.status).toBe(200);
    expect(datesIn(forMark.body)).toEqual([]);
  });

  it('splits a closed Cell’s meetings between the leaders who held it', async () => {
    // Two elapsed meetings, so there is something on each side of the handover. In a
    // month's first week that means last month, which section 13 keeps open until the
    // 7th, so the case runs every day of the year rather than most of them.
    const { month, dayOfWeek, dates, created } = await stage(2);
    const cell = await createCell(db, { leader: mark, dayOfWeek, createdAt: created });

    const handover = dates[0];
    const closure = dates[dates.length - 1];

    // Handed over the evening of the first Saturday, then closed after the last. Once
    // the Cell is CLOSED section 7's exception applies and each meeting resolves
    // through whoever led on its own scheduled date — so the split is by date, which
    // resolving through the Cell's last leader would flatten onto Ben alone.
    await handOver(cell, ben, manilaEndOf(handover));
    await closeCellDirectly(db, cell.id, {
      reason: 'LEADER_STEPPED_DOWN',
      at: manilaEndOf(closure),
    });

    const forMark = await queue(month, markAccount);
    expect(datesIn(forMark.body)).toEqual([handover]);

    const forBen = await queue(month, benAccount);
    expect(datesIn(forBen.body)).toEqual(dates.slice(1));
  });

  it('drops a meeting once it carries a record', async () => {
    // Two, so that recording one leaves something behind to prove the rest stayed.
    const { month, dayOfWeek, dates, created } = await stage(2);
    const cell = await createCell(db, { leader: mark, dayOfWeek, createdAt: created });

    // A member, because section 12 records attendance for members only and the submit
    // route refuses an empty roster: the queue's business is which meetings are owed,
    // and staging a real record is how a case proves one leaves.
    const juan = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
    await assignTo(db, juan.id, mark.id);
    await db
      .insertInto('cell_memberships')
      .values({ person_id: juan.id, cell_id: cell.id, started_at: created })
      .execute();

    const recorded = dates[0];
    const submitted = await request(app.getHttpServer())
      .post(`/api/v1/cells/${cell.id}/meetings/${recorded}/submit`)
      .set('Authorization', `Bearer ${markAccount.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ status: 'HELD', attendance: [{ person_id: juan.id, present: true }] });

    expect(submitted.status).toBe(201);

    const response = await queue(month, markAccount);
    expect(datesIn(response.body)).toEqual(dates.slice(1));
  });

  it('holds nobody else’s work', async () => {
    // Ben's Cell, Mark's queue. The owner's choice of 2026-09-15: the queue is the
    // leader's own work and nobody else's, and a downline leader's outstanding
    // meetings are section 15's attention list rather than somebody else's to-do list.
    const { month, dayOfWeek, created } = await stage(1);
    await createCell(db, { leader: ben, dayOfWeek, createdAt: created });

    const response = await queue(month, markAccount);

    expect(response.status).toBe(200);
    expect(datesIn(response.body)).toEqual([]);
  });

  it('answers a shut month empty rather than refusing it', async () => {
    const { dayOfWeek, created } = await stage(1);
    await createCell(db, { leader: mark, dayOfWeek, createdAt: created });

    // Two months back is shut under every reading of section 13's window, whatever day
    // of the month the suite runs on — one month back is shut only after the 7th.
    const today = await manilaToday();
    const [year, month] = today.split('-').map(Number);
    const shut = new Date(Date.UTC(year, month - 3, 1));
    const shutMonth = `${shut.getUTCFullYear()}-${String(shut.getUTCMonth() + 1).padStart(2, '0')}-01`;

    const response = await queue(shutMonth, markAccount);

    expect(response.status).toBe(200);
    expect(response.body.open).toBe(false);
    expect(response.body.meetings).toEqual([]);
  });
});
