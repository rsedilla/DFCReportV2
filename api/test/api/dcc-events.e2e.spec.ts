import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { manilaDayOf } from '../../src/common/time/manila';
import { databaseNow } from '../../src/common/time/submission-window';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * `GET /api/v1/dcc/events` and its coverage drill-down (SKILL.md sections 9, 15, 19 and
 * 22; decisions 0224, 0227 and 0228).
 *
 * **Authorization is exercised at the API layer**, which `CLAUDE.md` requires: both routes
 * decide their figure's scope in the domain layer where the guard decides only
 * reachability, so every case here asks what an account is *answered*.
 *
 * The tree is `Raymond (root) -> Manuel -> { Mark -> Timothy, Nathan }`. Manuel, Mark and
 * Raymond hold accounts. That shape gives three different coverage denominators for one
 * event: Raymond's scope holds every leader, Manuel's holds himself and Mark, and Mark's
 * holds only himself — which is what makes the figure scoped rather than church-wide.
 *
 * **Dates come from the database's own day**, for the reason `dcc-attendance.e2e.spec.ts`
 * gives: the service reads its instant from the database and there is no seam to inject
 * one, so a case pinned to a literal Sunday would be true this year and false next.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('the DCC events index and its coverage gaps (sections 9, 15 and 22)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let timothy: TestPerson;
  let nathan: TestPerson;

  let admin: TestAccount;
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

    mark = await createPerson(db, { firstName: 'Mark', lastName: 'Bautista', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);

    timothy = await createPerson(db, { firstName: 'Timothy', network: 'MENS' });
    await assignTo(db, timothy.id, mark.id);

    nathan = await createPerson(db, { firstName: 'Nathan', lastName: 'Cruz', network: 'MENS' });
    await assignTo(db, nathan.id, manuel.id);

    const adminPerson = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  // ---------------------------------------------------------------------------
  // Dates, all computed from the database's day
  // ---------------------------------------------------------------------------

  const today = async (): Promise<string> => manilaDayOf(await databaseNow(db));

  const shift = (day: string, days: number): string => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };

  const isoDayOf = (day: string): number => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  };

  /** The most recent Sunday strictly before today: always past, always in an open month. */
  const recentSunday = async (): Promise<string> => {
    const now = await today();
    const dayOfWeek = isoDayOf(now);

    return shift(now, dayOfWeek === 0 ? -7 : -dayOfWeek);
  };

  const monthOf = (day: string): string => `${day.slice(0, 7)}-01`;

  const createEvent = async (
    eventDate: string,
    // A removal is whole or absent (migration 0011): the instant, the actor and the
    // reason move together, so a fixture cannot record half of one.
    removal?: { reason: string; by: TestAccount },
  ): Promise<string> => {
    const row = await db
      .insertInto('dcc_events')
      .values({
        event_date: eventDate,
        removed_at: removal ? new Date() : null,
        removed_by: removal?.by.id ?? null,
        removal_reason: removal?.reason ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return row.id;
  };

  /** A live record for one person, attributed to their responsible leader. */
  const record = async (
    eventId: string,
    personId: string,
    leaderId: string,
    by: TestAccount,
  ): Promise<void> => {
    await db
      .insertInto('dcc_attendance')
      .values({
        dcc_event_id: eventId,
        person_id: personId,
        present: true,
        responsible_leader_id: leaderId,
        recorded_by: by.id,
      })
      .execute();
  };

  const events = async (as: TestAccount, month: string): Promise<request.Response> =>
    request(app.getHttpServer())
      .get('/api/v1/dcc/events')
      .query({ month })
      .set('Authorization', `Bearer ${as.accessToken}`);

  const gaps = async (
    as: TestAccount,
    eventId: string,
    query: Record<string, string | number> = {},
  ): Promise<request.Response> =>
    request(app.getHttpServer())
      .get(`/api/v1/dcc/events/${eventId}/coverage-gaps`)
      .query(query)
      .set('Authorization', `Bearer ${as.accessToken}`);

  // ---------------------------------------------------------------------------
  // The index (decision 0227)
  // ---------------------------------------------------------------------------

  it('lists the month’s events in date order', async () => {
    const sunday = await recentSunday();
    const earlier = shift(sunday, -7);

    // Both in one month, or the case is asserting about two months. Where the earlier
    // Sunday falls in the previous month there is nothing to order, so the case narrows
    // to the one event rather than pinning a relationship that is not there.
    const first = await createEvent(earlier);
    const second = await createEvent(sunday);
    const sameMonth = monthOf(earlier) === monthOf(sunday);

    const response = await events(manuelAccount, monthOf(sunday));

    expect(response.status).toBe(200);
    expect(response.body.reporting_month).toBe(monthOf(sunday));
    expect((response.body.data as { id: string }[]).map((row) => row.id)).toEqual(
      sameMonth ? [first, second] : [second],
    );
  });

  it('says whether each event is recordable, and why not', async () => {
    const sunday = await recentSunday();
    await createEvent(sunday, { reason: 'Typhoon', by: admin });

    const response = await events(manuelAccount, monthOf(sunday));
    const row = response.body.data[0];

    // Section 9: a removed Sunday is a decision somebody recorded, and it must be visible
    // on any view covering that month rather than being absent.
    expect(row.removed).toBe(true);
    expect(row.removal_reason).toBe('Typhoon');
    expect(row.recordable).toBe(false);
    expect(row.not_recordable_reason).toBe('REMOVED');
  });

  it('gives a removed event no coverage rather than 0 of 0', async () => {
    // Nobody owes a record for a service that was not held, and `0 of 0` would say the
    // obligations were all discharged (decision 0227).
    const sunday = await recentSunday();
    await createEvent(sunday, { reason: 'Typhoon', by: admin });

    const response = await events(manuelAccount, monthOf(sunday));

    expect(response.body.data[0].coverage).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Coverage, scoped (decisions 0224 and 0228)
  // ---------------------------------------------------------------------------

  it('measures coverage over the actor’s own scope and not the church', async () => {
    const sunday = await recentSunday();
    const eventId = await createEvent(sunday);

    // Manuel's scope holds three leaders — himself, Mark and Raymond above him? No:
    // `OWN_SUBTREE` is Manuel down. Of those, Manuel and Mark each lead somebody, so two
    // owe a record; Nathan and Timothy lead nobody and owe none.
    const manuelView = await events(manuelAccount, monthOf(sunday));
    expect(manuelView.body.data[0].coverage).toEqual({ met: 0, owed: 2 });

    // Mark's scope is Mark down, and he alone leads anybody in it.
    const markView = await events(markAccount, monthOf(sunday));
    expect(markView.body.data[0].coverage).toEqual({ met: 0, owed: 1 });

    // Whole Church adds Raymond, who leads Manuel.
    const adminView = await events(admin, monthOf(sunday));
    expect(adminView.body.data[0].coverage).toEqual({ met: 0, owed: 3 });

    // One record by Mark for Timothy discharges Mark's obligation and nobody else's.
    await record(eventId, timothy.id, mark.id, markAccount);

    expect((await events(manuelAccount, monthOf(sunday))).body.data[0].coverage).toEqual({
      met: 1,
      owed: 2,
    });
    expect((await events(markAccount, monthOf(sunday))).body.data[0].coverage).toEqual({
      met: 1,
      owed: 1,
    });
  });

  it('counts one record as discharging the whole obligation, however many disciples', async () => {
    // Section 9 measures "whether the record exists", not whether every disciple was
    // marked. Manuel leads two people; recording one of them completes his coverage.
    const sunday = await recentSunday();
    const eventId = await createEvent(sunday);

    await record(eventId, mark.id, manuel.id, manuelAccount);

    const response = await events(manuelAccount, monthOf(sunday));
    expect(response.body.data[0].coverage).toEqual({ met: 1, owed: 2 });
  });

  it('reads the live record and not the one it superseded', async () => {
    // A correction supersedes rather than overwrites (section 14), so a person can carry
    // two rows for one event and only one of them is the record. The pair here is a
    // correction that re-froze the responsible leader — Timothy's record moving from Mark
    // to Manuel — which is the one shape in which counting the superseded row changes an
    // answer: it would cover Mark on the strength of a record that no longer names him.
    //
    // **Written in the order the schema permits, which is the order the service uses.**
    // `dcc_attendance_one_live` refuses a second live row, so the predecessor is closed
    // first; migration 0013 refuses a row naming itself as its own successor, so it is
    // closed *against the successor's identifier*, generated here and inserted after. The
    // `superseded_by` foreign key is deferred for exactly that ordering, so both
    // statements share one transaction.
    const sunday = await recentSunday();
    const eventId = await createEvent(sunday);

    const supersededId = randomUUID();
    const successorId = randomUUID();

    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('dcc_attendance')
        .values({
          id: supersededId,
          dcc_event_id: eventId,
          person_id: timothy.id,
          present: true,
          responsible_leader_id: mark.id,
          recorded_by: markAccount.id,
        })
        .execute();

      await trx
        .updateTable('dcc_attendance')
        .set({ superseded_at: sql<Date>`clock_timestamp()`, superseded_by: successorId })
        .where('id', '=', supersededId)
        .execute();

      await trx
        .insertInto('dcc_attendance')
        .values({
          id: successorId,
          dcc_event_id: eventId,
          person_id: timothy.id,
          present: true,
          responsible_leader_id: manuel.id,
          recorded_by: manuelAccount.id,
          // Migration 0013: a successor begins exactly where its predecessor ended, so
          // the chain has no gap and no overlap. Read in SQL from the row just closed,
          // which is what the service does — a second host clock reading would differ by
          // microseconds and be refused.
          recorded_at: sql<Date>`(SELECT superseded_at FROM dcc_attendance WHERE id = ${supersededId})`,
          correction_reason: 'The responsible leader was frozen wrongly.',
        })
        .execute();
    });

    // Mark's superseded row covers him no longer.
    expect((await events(markAccount, monthOf(sunday))).body.data[0].coverage).toEqual({
      met: 0,
      owed: 1,
    });
    // Manuel's live one covers Manuel.
    expect((await events(manuelAccount, monthOf(sunday))).body.data[0].coverage).toEqual({
      met: 1,
      owed: 2,
    });
  });

  it('does not move a past event’s figure when a disciple is archived today', async () => {
    // Section 3: "archiving someone today must never change the total shown for a period
    // before their archive date, no matter when the report is re-run", and period-based
    // figures are "never filtered by current lifecycle state". A first version of this
    // service dropped an archived disciple's edge from the denominator, reading the
    // **current** lifecycle row against a dated edge set — so this figure went from
    // `1 of 1` to `0 of 0` on an archive performed today.
    const sunday = await recentSunday();
    const eventId = await createEvent(sunday);
    await record(eventId, timothy.id, mark.id, markAccount);

    const before = (await events(markAccount, monthOf(sunday))).body.data[0].coverage;
    expect(before).toEqual({ met: 1, owed: 1 });

    // `person_lifecycle` is effective-dated and holds one open row per Person (section 3),
    // so archiving is a close-and-open pair at one instant rather than an insert.
    const archivedAt = new Date();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('person_lifecycle')
        .set({ ended_at: archivedAt })
        .where('person_id', '=', timothy.id)
        .where('ended_at', 'is', null)
        .execute();

      await trx
        .insertInto('person_lifecycle')
        .values({
          person_id: timothy.id,
          state: 'ARCHIVED',
          reason: 'NO_LONGER_IN_CURRENT_NETWORK',
          started_at: archivedAt,
        })
        .execute();
    });

    const after = (await events(markAccount, monthOf(sunday))).body.data[0].coverage;
    expect(after).toEqual(before);
  });

  it('gives an event whose day has not begun no coverage figure', async () => {
    // Section 9 defines the gap for "an event that did take place". `0 of 8` for next
    // Sunday says eight leaders have failed to record a service that has not happened,
    // which is the accusation section 13 exists to prevent, manufactured by arithmetic.
    const now = await today();
    const dayOfWeek = isoDayOf(now);
    const upcoming = shift(now, dayOfWeek === 0 ? 7 : 7 - dayOfWeek);
    await createEvent(upcoming);

    const response = await events(manuelAccount, monthOf(upcoming));
    const row = (response.body.data as { event_date: string; coverage: unknown }[]).find(
      (entry) => entry.event_date === upcoming,
    );

    expect(row?.coverage).toBeNull();
  });

  it('names nobody as owing a record for an event whose day has not begun', async () => {
    // Section 15: each entry on an attention list "offers the actions that resolve it".
    // Nothing resolves a record for a service that has not happened.
    const now = await today();
    const dayOfWeek = isoDayOf(now);
    const upcoming = shift(now, dayOfWeek === 0 ? 7 : 7 - dayOfWeek);
    const eventId = await createEvent(upcoming);

    const response = await gaps(manuelAccount, eventId);

    expect(response.body.data).toEqual([]);
  });

  it('never divides the two figures', async () => {
    const sunday = await recentSunday();
    await createEvent(sunday);

    const response = await events(markAccount, monthOf(sunday));

    // Section 13 forbids a derived score, so the response carries the two terms and
    // nothing computed from them.
    expect(Object.keys(response.body.data[0].coverage).sort()).toEqual(['met', 'owed']);
  });

  // ---------------------------------------------------------------------------
  // The drill-down (decision 0228)
  // ---------------------------------------------------------------------------

  it('names the leaders in scope who owe a record, ordered by name', async () => {
    const sunday = await recentSunday();
    const eventId = await createEvent(sunday);

    const response = await gaps(manuelAccount, eventId);

    expect(response.status).toBe(200);
    // Bautista before Testfixture: section 8's directory order, which section 15 permits
    // and which says nothing about who is furthest behind.
    expect((response.body.data as { person_id: string }[]).map((row) => row.person_id)).toEqual([
      mark.id,
      manuel.id,
    ]);
  });

  it('drops a leader once they have a record', async () => {
    const sunday = await recentSunday();
    const eventId = await createEvent(sunday);

    await record(eventId, timothy.id, mark.id, markAccount);

    const response = await gaps(manuelAccount, eventId);

    expect((response.body.data as { person_id: string }[]).map((row) => row.person_id)).toEqual([
      manuel.id,
    ]);
  });

  it('names nobody outside the actor’s scope', async () => {
    // Mark's list holds Mark and never Manuel above him, which is the whole of what
    // decision 0228 makes load-bearing: the same data church-wide, ordered by how many
    // records are missing, is the leaderboard section 13 exists to prevent.
    const sunday = await recentSunday();
    const eventId = await createEvent(sunday);

    const response = await gaps(markAccount, eventId);

    expect((response.body.data as { person_id: string }[]).map((row) => row.person_id)).toEqual([
      mark.id,
    ]);
  });

  it('carries no figure a client could rank by', async () => {
    const sunday = await recentSunday();
    const eventId = await createEvent(sunday);

    const response = await gaps(markAccount, eventId);

    // A count of missing records per leader would be a score, and a screen would sort by
    // it. The row is an identity and nothing else.
    expect(Object.keys(response.body.data[0]).sort()).toEqual([
      'full_name',
      'member_id',
      'person_id',
    ]);
  });

  it('names nobody for a removed event', async () => {
    const sunday = await recentSunday();
    const eventId = await createEvent(sunday, { reason: 'Typhoon', by: admin });

    const response = await gaps(manuelAccount, eventId);

    expect(response.body.data).toEqual([]);
    expect(response.body.event.removed).toBe(true);
  });

  it('pages the gap list by cursor', async () => {
    const sunday = await recentSunday();
    const eventId = await createEvent(sunday);

    const first = await gaps(manuelAccount, eventId, { limit: 1 });
    expect(first.body.data).toHaveLength(1);
    expect(first.body.next_cursor).not.toBeNull();

    const second = await gaps(manuelAccount, eventId, {
      limit: 1,
      cursor: first.body.next_cursor,
    });
    expect(second.body.data).toHaveLength(1);
    expect(second.body.next_cursor).toBeNull();

    expect([
      ...(first.body.data as { person_id: string }[]).map((row) => row.person_id),
      ...(second.body.data as { person_id: string }[]).map((row) => row.person_id),
    ]).toEqual([mark.id, manuel.id]);
  });

  it('refuses a cursor it cannot read', async () => {
    const sunday = await recentSunday();
    const eventId = await createEvent(sunday);

    const response = await gaps(manuelAccount, eventId, { cursor: 'not-a-cursor' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('answers NOT_FOUND for an event that does not exist', async () => {
    const response = await gaps(manuelAccount, '11111111-1111-4111-8111-111111111111');

    expect(response.status).toBe(404);
  });

  it('refuses a malformed event identifier rather than reaching the database', async () => {
    // Section 7: a path parameter the guard does not resolve against must be validated by
    // the route, or a `uuid` comparison answers with a database error rather than a
    // refusal.
    const response = await gaps(manuelAccount, 'not-a-uuid');

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  // ---------------------------------------------------------------------------
  // The guard (section 7)
  // ---------------------------------------------------------------------------

  it('refuses both routes to an account holding no capability', async () => {
    const outsider = await createPerson(db, { firstName: 'Rex', network: 'MENS' });
    await assignTo(db, outsider.id, raymond.id);
    const account = await createAccount(app, db, { person: outsider, roles: [] });

    const sunday = await recentSunday();
    const eventId = await createEvent(sunday);

    expect((await events(account, monthOf(sunday))).status).toBe(403);
    expect((await gaps(account, eventId)).status).toBe(403);
  });

  it('refuses an unauthenticated request', async () => {
    const sunday = await recentSunday();

    const response = await request(app.getHttpServer())
      .get('/api/v1/dcc/events')
      .query({ month: monthOf(sunday) });

    expect(response.status).toBe(401);
  });

  it('requires a month on the index', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/dcc/events')
      .set('Authorization', `Bearer ${manuelAccount.accessToken}`);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});
