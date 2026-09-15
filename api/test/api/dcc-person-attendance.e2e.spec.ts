import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { DccFiguresService } from '../../src/attendance/dcc-figures.service';
import { databaseNow } from '../../src/common/time/submission-window';
import { manilaDayOf } from '../../src/common/time/manila';
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
 * One person's DCC attendance and classification (SKILL.md section 9; decision 0247).
 *
 * `GET /api/v1/dcc/people/{id}/attendance` is guarded by `dcc.view_subtree` against the
 * person and names no period, so it asks about now. These cases pin who may read it, what
 * it lists, and that its classification counts what the monthly report counts.
 *
 * Dates are computed from the database's own day, for the reason
 * `dcc-attendance.e2e.spec.ts` gives. Records on Sundays whose month has closed are
 * inserted directly: the route reads history, and recording that history through the API
 * would need every month to be open. The one correction is made through the API, so the
 * superseded row is the shape the service writes.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('one person’s DCC attendance (section 9, decision 0247)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  // Raymond (root) -> Manuel -> Mark -> Timothy, and Raymond -> Nathan beside Manuel.
  // Raymond -> Norma -> Tessa is a separate branch for the capability cases.
  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let timothy: TestPerson;
  let nathan: TestPerson;
  let norma: TestPerson;
  let tessa: TestPerson;

  let admin: TestAccount;
  let manuelAccount: TestAccount;
  let markAccount: TestAccount;
  let normaAccount: TestAccount;

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

    nathan = await createPerson(db, { firstName: 'Nathan', network: 'MENS' });
    await assignTo(db, nathan.id, raymond.id);

    norma = await createPerson(db, { firstName: 'Norma', network: 'MENS' });
    await assignTo(db, norma.id, raymond.id);

    tessa = await createPerson(db, { firstName: 'Tessa', network: 'MENS' });
    await assignTo(db, tessa.id, norma.id);

    const adminPerson = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
    normaAccount = await createAccount(app, db, { person: norma, roles: [] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  // ---------------------------------------------------------------------------
  // Dates, computed from the database's day
  // ---------------------------------------------------------------------------

  const today = async (): Promise<string> => manilaDayOf(await databaseNow(db));

  const shift = (day: string, days: number): string => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };

  /** The most recent Sunday strictly before today, which is always inside an open month. */
  const recentSunday = async (): Promise<string> => {
    const now = await today();
    const [y, m, d] = now.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    return shift(now, dayOfWeek === 0 ? -7 : -dayOfWeek);
  };

  // ---------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------

  const createEvent = async (eventDate: string, removedBy?: string): Promise<string> => {
    const row = await db
      .insertInto('dcc_events')
      .values({
        event_date: eventDate,
        removed_at: removedBy ? new Date() : null,
        removed_by: removedBy ?? null,
        removal_reason: removedBy ? 'A combined regional service.' : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return row.id;
  };

  const insertRecord = async (
    eventId: string,
    person: TestPerson,
    present: boolean,
    leader: TestPerson,
    by: TestAccount,
  ): Promise<void> => {
    await db
      .insertInto('dcc_attendance')
      .values({
        dcc_event_id: eventId,
        person_id: person.id,
        present,
        responsible_leader_id: leader.id,
        recorded_by: by.id,
      })
      .execute();
  };

  const attendance = (account: TestAccount, personId: string, query = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/dcc/people/${personId}/attendance${query}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const submit = (account: TestAccount, eventId: string, records: unknown[]) =>
    request(app.getHttpServer())
      .post(`/api/v1/dcc/events/${eventId}/submit`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ records });

  /**
   * Timothy's history: six Sundays newest first, one corrected, one removed, one absent.
   *
   * Counted are s1, s4 and s5. s0 was recorded present and corrected to absent, s2 is on a
   * removed Sunday, and s3 is absent, so the classification is `3RD_TIMER`.
   */
  const timothyHistory = async () => {
    const s0 = await recentSunday();
    const days = [
      s0,
      shift(s0, -7),
      shift(s0, -14),
      shift(s0, -21),
      shift(s0, -28),
      shift(s0, -35),
    ];

    const e0 = await createEvent(days[0]);
    const e1 = await createEvent(days[1]);
    const e2 = await createEvent(days[2], admin.id);
    const e3 = await createEvent(days[3]);
    const e4 = await createEvent(days[4]);
    const e5 = await createEvent(days[5]);

    await insertRecord(e1, timothy, true, mark, markAccount);
    await insertRecord(e2, timothy, true, mark, markAccount);
    await insertRecord(e3, timothy, false, mark, markAccount);
    await insertRecord(e4, timothy, true, mark, markAccount);
    await insertRecord(e5, timothy, true, mark, markAccount);

    await submit(markAccount, e0, [{ person_id: timothy.id, present: true, version: null }]).expect(
      201,
    );
    await submit(markAccount, e0, [{ person_id: timothy.id, present: false, version: 1 }]).expect(
      201,
    );

    return { days, events: [e0, e1, e2, e3, e4, e5] };
  };

  // ---------------------------------------------------------------------------
  // What it lists and counts
  // ---------------------------------------------------------------------------

  it('lists live records newest first, marks a removed Sunday, and counts only what counts', async () => {
    const { days, events } = await timothyHistory();

    // Two generations up: the widening decision 0247 states.
    const response = await attendance(manuelAccount, timothy.id).expect(200);

    expect(response.body.person_id).toBe(timothy.id);
    expect(response.body.classification).toBe('3RD_TIMER');
    expect(response.body.attended).toBe(3);
    expect(response.body.next_cursor).toBeNull();

    expect(response.body.data).toEqual([
      { event_id: events[0], event_date: days[0], present: false, removed: false },
      { event_id: events[1], event_date: days[1], present: true, removed: false },
      { event_id: events[2], event_date: days[2], present: true, removed: true },
      { event_id: events[3], event_date: days[3], present: false, removed: false },
      { event_id: events[4], event_date: days[4], present: true, removed: false },
      { event_id: events[5], event_date: days[5], present: true, removed: false },
    ]);
  });

  it('climbs section 9’s ladder and has no classification before any attendance', async () => {
    const s0 = await recentSunday();

    const empty = await attendance(admin, timothy.id).expect(200);
    expect(empty.body.classification).toBeNull();
    expect(empty.body.attended).toBe(0);
    expect(empty.body.data).toEqual([]);

    const expected = ['VIP', '2ND_TIMER', '3RD_TIMER', '4TH_TIMER', 'REGULAR', 'REGULAR'];

    for (let index = 0; index < expected.length; index += 1) {
      const eventId = await createEvent(shift(s0, -7 * (index + 1)));
      await insertRecord(eventId, timothy, true, mark, markAccount);

      const response = await attendance(admin, timothy.id).expect(200);

      expect(response.body.attended).toBe(index + 1);
      expect(response.body.classification).toBe(expected[index]);
    }
  });

  it('counts what the monthly figures count for the same person', async () => {
    const { days } = await timothyHistory();

    // The monthly figures cover people who attended in the month asked for, so ask for the
    // month of s1, where Timothy was present. No record after s1 is counted, because s0 was
    // corrected to absent, so the lifetime through that month is the lifetime now.
    const figures = await app
      .get(DccFiguresService)
      .monthFigures(`${days[1].slice(0, 7)}-01`, { personIds: [timothy.id] });

    const person = figures.people.find((row) => row.personId === timothy.id);
    const response = await attendance(admin, timothy.id).expect(200);

    expect(person).toBeDefined();
    expect(response.body.attended).toBe(person?.lifetimeThroughMonth);
  });

  it('pages newest first by cursor and keeps the classification on every page', async () => {
    const { events } = await timothyHistory();

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const query: string = cursor === null ? '?limit=2' : `?limit=2&cursor=${cursor}`;
      const response = await attendance(admin, timothy.id, query).expect(200);

      expect(response.body.classification).toBe('3RD_TIMER');
      seen.push(...response.body.data.map((row: { event_id: string }) => row.event_id));
      cursor = response.body.next_cursor;
      pages += 1;
    } while (cursor !== null && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toEqual(events);
  });

  it('refuses a cursor it cannot read', async () => {
    const response = await attendance(admin, timothy.id, '?cursor=not-a-cursor');

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.field).toBe('cursor');
  });

  // ---------------------------------------------------------------------------
  // Who may read it
  // ---------------------------------------------------------------------------

  it('refuses a person outside the actor’s scope, and says nothing of their record', async () => {
    const eventId = await createEvent(shift(await recentSunday(), -7));
    await insertRecord(eventId, nathan, true, raymond, admin);

    const response = await attendance(manuelAccount, nathan.id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('SCOPE_DENIED');
    expect(response.body.data).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('classification');
  });

  it('answers an unknown person not found to a whole-church reader and refuses it to a leader', async () => {
    const unknown = randomUUID();

    const wholeChurch = await attendance(admin, unknown);
    expect(wholeChurch.status).toBe(404);
    expect(wholeChurch.body.error.code).toBe('NOT_FOUND');

    const leader = await attendance(manuelAccount, unknown);
    expect(leader.status).toBe(403);
    expect(leader.body.error.code).toBe('SCOPE_DENIED');
  });

  it('refuses a malformed person identifier', async () => {
    const response = await attendance(admin, 'not-a-uuid');

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses an account without dcc.view_subtree and admits a read-only grant of it', async () => {
    const eventId = await createEvent(shift(await recentSunday(), -7));
    await insertRecord(eventId, tessa, true, norma, admin);

    const refused = await attendance(normaAccount, tessa.id);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('CAPABILITY_DENIED');

    await db
      .insertInto('capability_grants')
      .values({
        account_id: normaAccount.id,
        capability: 'dcc.view_subtree',
        scope_type: 'OWN_SUBTREE',
        read_only: true,
        reason: 'Invented for this case (CLAUDE.md, Secrets).',
        granted_by: admin.id,
      })
      .execute();

    const admitted = await attendance(normaAccount, tessa.id).expect(200);
    expect(admitted.body.classification).toBe('VIP');
  });

  it('admits a Senior Pastor to a person in either Network', async () => {
    const eventId = await createEvent(shift(await recentSunday(), -7));
    await insertRecord(eventId, timothy, true, mark, markAccount);

    // Section 7 names the two Senior Pastors from configuration, so the fixture says who.
    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'WOMENS' });
    nameSeniorPastors(app, [oriel.id]);
    const orielAccount = await createAccount(app, db, {
      person: oriel,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });

    const response = await attendance(orielAccount, timothy.id).expect(200);
    expect(response.body.classification).toBe('VIP');
  });

  it('holds a NETWORK grant to the person’s current Network', async () => {
    const eventId = await createEvent(shift(await recentSunday(), -7));
    await insertRecord(eventId, nathan, true, raymond, admin);

    await db
      .insertInto('capability_grants')
      .values({
        account_id: normaAccount.id,
        capability: 'dcc.view_subtree',
        scope_type: 'NETWORK',
        scope_network: 'MENS',
        read_only: true,
        reason: 'Invented for this case (CLAUDE.md, Secrets).',
        granted_by: admin.id,
      })
      .execute();

    // Nathan is in the Men's Network and outside Norma's own subtree.
    const admitted = await attendance(normaAccount, nathan.id).expect(200);
    expect(admitted.body.classification).toBe('VIP');

    // The admin account's person is in the Women's Network.
    const refused = await attendance(normaAccount, admin.personId);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('SCOPE_DENIED');
  });
});
