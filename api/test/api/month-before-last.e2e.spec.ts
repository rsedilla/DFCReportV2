import { randomUUID } from 'node:crypto';

import request from 'supertest';

import * as submissionWindow from '../../src/common/time/submission-window';
import { createTestDb, truncateAll } from '../setup/database';
import {
  addCellMember,
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
  resetRateLimits,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * A month two back is still open (SKILL.md section 13, decision 0434). A week closes three
 * Mondays after its due Monday, 29 to 35 days after its month's last day, so a month can stay
 * open into the month after next, and the Pending lists look that far back.
 *
 * - **Cell meetings.** August 2026 ends on Monday the 31st, whose week closes at noon on Monday
 *   5 October once the weekly rule is moved to January 2026. On Friday 2 October a Monday Cell's
 *   31 August meeting is still owed, two months back; its 24 August meeting closed at noon on
 *   28 September. A past date, because whether a meeting has come is read from the database's
 *   own clock, which no spy reaches.
 * - **DCC.** January 2027 ends on Sunday the 31st, whose week closes at noon on Monday 1 March,
 *   because February has 28 days. At 09:00 that morning the Sunday of 31 January is still owed,
 *   two months back; at noon it has closed.
 *
 * `databaseNow`, the one instant each route reads (decision 0160), is held at each date. Fixture
 * names are invented (CLAUDE.md, Secrets).
 */
describe('A month two back while it is open (decision 0434)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let clock: jest.SpyInstance;

  let raymond: TestPerson;
  let mark: TestPerson;
  let reader: TestAccount;

  const previous = process.env.WEEKLY_DEADLINE_FROM;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    delete process.env.WEEKLY_DEADLINE_FROM;
    await truncateAll(db);
    resetRateLimits(app);

    raymond = await createPerson(db, { firstName: 'Raymond', lastName: 'Bernal', network: 'MENS' });
    await assignTo(db, raymond.id, null);
    mark = await createPerson(db, { firstName: 'Mark', lastName: 'Castillo', network: 'MENS' });
    await assignTo(db, mark.id, raymond.id);
    reader = await createAccount(app, db, { person: raymond, roles: ['LEADER'], fullView: true });
  });

  afterEach(() => {
    clock?.mockRestore();
  });

  afterAll(async () => {
    if (previous === undefined) {
      delete process.env.WEEKLY_DEADLINE_FROM;
    } else {
      process.env.WEEKLY_DEADLINE_FROM = previous;
    }
    await db.destroy();
    await app.close();
  });

  const at = (instant: string): void => {
    clock = jest.spyOn(submissionWindow, 'databaseNow').mockResolvedValue(new Date(instant));
  };

  const get = async (path: string): Promise<request.Response> =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .expect(200);

  it('closes November 2026 in January and January 2027 in March', () => {
    expect(submissionWindow.monthClosesAt('2026-11-01').toISOString()).toBe(
      '2027-01-04T04:00:00.000Z',
    );
    expect(submissionWindow.monthClosesAt('2027-01-01').toISOString()).toBe(
      '2027-03-01T04:00:00.000Z',
    );
  });

  it('lists a Cell meeting from the month before last on Pending CG Records while its week is open', async () => {
    process.env.WEEKLY_DEADLINE_FROM = '2026-01-05';
    const cell = await createCell(db, {
      leader: mark,
      dayOfWeek: 1,
      createdAt: new Date('2026-06-01T10:00:00+08:00'),
    });
    await addCellMember(db, cell);
    expect(submissionWindow.monthClosesAt('2026-08-01').toISOString()).toBe(
      '2026-10-05T04:00:00.000Z',
    );

    at('2026-10-02T10:00:00+08:00');
    const body = (await get('/api/v1/cells/meetings/pending')).body as {
      data: {
        cell: { id: string };
        meetings: { scheduled_date: string; reporting_month: string }[];
      }[];
    };
    const meetings = body.data.find((row) => row.cell.id === cell.id)?.meetings ?? [];

    expect(meetings.map((meeting) => meeting.scheduled_date)).toContain('2026-08-31');
    expect(meetings.find((meeting) => meeting.scheduled_date === '2026-08-31')).toMatchObject({
      reporting_month: '2026-08-01',
    });
    expect(meetings.map((meeting) => meeting.scheduled_date)).not.toContain('2026-08-24');
  });

  it('lists a Sunday from the month before last on Pending DCC Records until its week closes', async () => {
    await createAccount(app, db, { person: mark, roles: ['LEADER'] });
    const event = await db
      .insertInto('dcc_events')
      .values({ event_date: '2027-01-31' })
      .returning('id')
      .executeTakeFirstOrThrow();

    const sundays = async (): Promise<string[]> => {
      const body = (await get('/api/v1/dcc/pending-leaders')).body as {
        data: { leader: { person_id: string }; sundays: { event_id: string }[] }[];
      };

      return body.data.flatMap((row) => row.sundays.map((sunday) => sunday.event_id));
    };

    at('2027-03-01T09:00:00+08:00');
    expect(await sundays()).toContain(event.id);

    clock.mockRestore();
    at('2027-03-01T12:00:00+08:00');
    expect(await sundays()).not.toContain(event.id);
  });

  it('takes a record for the month before last while its week is open', async () => {
    const markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
    const pedro = await createPerson(db, {
      firstName: 'Pedro',
      lastName: 'Flores',
      network: 'MENS',
    });
    await assignTo(db, pedro.id, mark.id);
    const event = await db
      .insertInto('dcc_events')
      .values({ event_date: '2027-01-31' })
      .returning('id')
      .executeTakeFirstOrThrow();

    at('2027-03-01T09:00:00+08:00');
    await request(app.getHttpServer())
      .post(`/api/v1/dcc/events/${event.id}/submit`)
      .set('Authorization', `Bearer ${markAccount.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ records: [{ person_id: pedro.id, present: true, version: null }] })
      .expect(201);
  });
});
