import request from 'supertest';

import { manilaDayOf } from '../../src/common/time/manila';
import { databaseNow } from '../../src/common/time/submission-window';
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
 * `GET /api/v1/cells` — the Cells of the actor's scope (SKILL.md sections 10, 12, 19 and
 * 22; decision 0226).
 *
 * **Authorization is exercised here rather than only in the service**, which `CLAUDE.md`
 * requires: the API is the sole authority for authorization (section 7), and a list route
 * decides membership in its domain layer where the guard decides only reachability. So
 * the cases below ask what each account is *answered*, never what a service returns.
 *
 * The tree is `Raymond (root) -> Manuel -> { Mark, Nathan }`, with a Cell each for Manuel,
 * Mark and Nathan. Manuel's subtree contains all three; Mark's contains one. That shape is
 * what makes "the actor's scope" and "the Cells the actor leads" two different answers,
 * which is the distinction decision 0226 exists to serve.
 *
 * **Dates come from the database's own day.** The coverage denominator is derived from the
 * schedule against a real calendar, so a month written down here would be a four- or
 * five-Saturday month depending on the year. Every case computes what it needs.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('the Cells index (sections 10, 12 and 22)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let nathan: TestPerson;

  let manuelCell: TestCell;
  let markCell: TestCell;
  let nathanCell: TestCell;

  let admin: TestAccount;
  let manuelAccount: TestAccount;
  let markAccount: TestAccount;

  /** Long enough ago that every month these cases ask about has a schedule in force. */
  const CREATED = new Date('2020-01-04T10:00:00+08:00');

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

    nathan = await createPerson(db, { firstName: 'Nathan', network: 'MENS' });
    await assignTo(db, nathan.id, manuel.id);

    // Saturday Cells, so a month holds four or five meetings depending on the calendar.
    manuelCell = await createCell(db, { leader: manuel, dayOfWeek: 6, createdAt: CREATED });
    markCell = await createCell(db, { leader: mark, dayOfWeek: 6, createdAt: CREATED });
    nathanCell = await createCell(db, { leader: nathan, dayOfWeek: 6, createdAt: CREATED });

    const adminPerson = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** The reporting month the database is currently in. */
  const thisMonth = async (): Promise<string> =>
    `${manilaDayOf(await databaseNow(db)).slice(0, 7)}-01`;

  const list = async (
    as: TestAccount,
    query: Record<string, string | number> = {},
  ): Promise<request.Response> =>
    request(app.getHttpServer())
      .get('/api/v1/cells')
      .query({ month: await thisMonth(), ...query })
      .set('Authorization', `Bearer ${as.accessToken}`);

  const cellIdsOf = (response: request.Response): string[] =>
    (response.body.data as { id: string }[]).map((row) => row.id).sort();

  // ---------------------------------------------------------------------------
  // Scope
  // ---------------------------------------------------------------------------

  it('lists the Cells whose leader is inside the actor’s subtree, and no others', async () => {
    const response = await list(manuelAccount);

    expect(response.status).toBe(200);
    // Manuel's own Cell and both of his disciples'. Section 7 places a Cell through its
    // leader, and `OWN_SUBTREE` includes the actor.
    expect(cellIdsOf(response)).toEqual([manuelCell.id, markCell.id, nathanCell.id].sort());
  });

  it('does not list a sibling branch’s Cell', async () => {
    // Mark leads one Cell and oversees nobody, so Nathan's Cell is outside his scope and
    // Manuel's is above him. **Answered 200 with a shorter list rather than 403**: the
    // guard's target is the actor, so reachability and membership are different questions,
    // and a refusal here would be a refusal of the route rather than of a row.
    const response = await list(markAccount);

    expect(response.status).toBe(200);
    expect(cellIdsOf(response)).toEqual([markCell.id]);
  });

  it('lists every Cell for a Whole Church grant', async () => {
    const response = await list(admin);

    expect(response.status).toBe(200);
    expect(cellIdsOf(response)).toEqual([manuelCell.id, markCell.id, nathanCell.id].sort());
  });

  it('narrows to the actor’s own Cells under ?led_by=me', async () => {
    const response = await list(manuelAccount, { led_by: 'me' });

    expect(response.status).toBe(200);
    expect(cellIdsOf(response)).toEqual([manuelCell.id]);
  });

  it('narrows a Whole Church grant the same way, rather than ignoring the filter', async () => {
    // Adele leads no Cell. The filter therefore empties a list that would otherwise hold
    // three — which is what makes it a narrowing of one authorized set rather than a
    // second scope: a reading that returned "the Cells of the actor's subtree" would
    // answer differently here, and a reading that ignored the filter for Whole Church
    // would answer three.
    const response = await list(admin, { led_by: 'me' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('lists under a NETWORK grant exactly what the per-Cell guard admits', async () => {
    // **The enumeration and the guard are one rule read two ways, and they diverged.**
    // `scopeCovers` resolves a person's Network with `ORDER BY started_at DESC LIMIT 1`;
    // a first version of `scopeMembership` asked `peopleInNetworkAsOf`, which fans out
    // over *every* row in force. `network_assignments_one_open` is partial over open rows,
    // so a closed `MENS` row ending in the future beside an open `WOMENS` one satisfies
    // every constraint — and the list carried a Cell the roster route then refused.
    //
    // The overlap is unreachable through any write path and is a Stop Condition recorded
    // in `CLAUDE.md`; it is staged here because it is the one state that tells the two
    // readings apart, and because the list failing **open** is the wrong direction.
    // **`MENS` themselves, because the guard's target is the actor.** A `NETWORK` grant
    // covers the caller only where the caller resolves to that Network, so a `WOMENS`
    // observer holding a `MENS` grant is refused the route outright and never reaches the
    // narrowing this case is about.
    const observerPerson = await createPerson(db, { firstName: 'Owen', network: 'MENS' });
    await assignTo(db, observerPerson.id, raymond.id);
    const observer = await createAccount(app, db, { person: observerPerson, roles: [] });

    await db
      .insertInto('capability_grants')
      .values({
        account_id: observer.id,
        capability: 'cell.view_subtree',
        scope_type: 'NETWORK',
        scope_network: 'MENS',
        read_only: true,
        reason: 'Invented for this case (CLAUDE.md, Secrets).',
        granted_by: admin.id,
      })
      .execute();

    // **The overlapping Person holds no pastoral edge**, which section 5 permits and which
    // is what makes the state stageable at all: `assert_network_change_keeps_edges` refuses
    // a Network change that would leave an edge crossing, and a Cell with no members trips
    // no leadership-Network trigger either. They lead a Cell, which is all this list needs.
    const drifting = await createPerson(db, { firstName: 'Dominic', network: 'MENS' });
    const driftingCell = await createCell(db, {
      leader: drifting,
      dayOfWeek: 6,
      createdAt: CREATED,
    });

    // Mark is `MENS` and resolves `MENS`, so both readings admit his Cell.
    expect(cellIdsOf(await list(observer))).toContain(markCell.id);
    expect(cellIdsOf(await list(observer))).toContain(driftingCell.id);

    // A second row: the open `MENS` one is closed in the future and a `WOMENS` row opens
    // now, so `networkAsOf` resolves `WOMENS` while a fan-out over rows in force still
    // names `MENS`.
    await db
      .updateTable('network_assignments')
      .set({ ended_at: new Date('2099-01-01T00:00:00Z') })
      .where('person_id', '=', drifting.id)
      .where('ended_at', 'is', null)
      .execute();

    await db
      .insertInto('network_assignments')
      .values({ person_id: drifting.id, network: 'WOMENS', started_at: new Date() })
      .execute();

    const listed = cellIdsOf(await list(observer));
    const roster = await request(app.getHttpServer())
      .get(`/api/v1/cells/${driftingCell.id}/members`)
      .set('Authorization', `Bearer ${observer.accessToken}`);

    // Whatever the two readings would each say, the list and the guard must say it
    // together: a Cell the list carries is one the per-Cell route serves.
    expect(listed.includes(driftingCell.id)).toBe(roster.status === 200);
    expect(roster.status).toBe(403);
  });

  it('refuses an account holding no capability at all', async () => {
    // A Person with an account and no role holds no `cell.view_subtree`, so the guard
    // refuses before any narrowing runs. Section 7: an endpoint declaring a capability is
    // closed until the actor holds it.
    const outsider = await createPerson(db, { firstName: 'Rex', network: 'MENS' });
    await assignTo(db, outsider.id, raymond.id);
    const account = await createAccount(app, db, { person: outsider, roles: [] });

    const response = await list(account);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CAPABILITY_DENIED');
  });

  it('refuses an unauthenticated request', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cells')
      .query({ month: await thisMonth() });

    expect(response.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // What a row carries
  // ---------------------------------------------------------------------------

  it('carries the Cell’s identity, category, schedule and current leader', async () => {
    const response = await list(markAccount);
    const row = response.body.data[0];

    expect(row).toEqual(
      expect.objectContaining({
        id: markCell.id,
        cell_id: markCell.cellId,
        category: markCell.category,
        schedule: { day_of_week: 6, time_of_day: markCell.timeOfDay },
      }),
    );
    // The Member ID is read back from the database rather than restated: section 3
    // generates it, so a literal here would be a second source for a value the fixture
    // does not carry.
    const stored = await db
      .selectFrom('persons')
      .select('member_id')
      .where('id', '=', mark.id)
      .executeTakeFirstOrThrow();

    expect(row.leader).toEqual({
      person_id: mark.id,
      member_id: stored.member_id,
      full_name: 'Mark Testfixture',
    });
  });

  it('carries coverage as two figures and never as a ratio', async () => {
    const month = await thisMonth();
    const response = await list(markAccount);
    const coverage = response.body.data[0].coverage;

    // Two figures, never divided (sections 12 and 13). Nothing has been recorded, so the
    // numerator is zero and the denominator is the month's Saturdays — which is four or
    // five, computed here rather than written down.
    expect(coverage.recorded).toBe(0);
    expect(coverage.scheduled).toBe(saturdaysIn(month));
    expect(Object.keys(coverage).sort()).toEqual(['recorded', 'scheduled']);
    expect(response.body.reporting_month).toBe(month);
  });

  it('counts a recorded meeting into the numerator, whatever its status', async () => {
    // A `NOT_HELD` meeting is a record: the leader filed it, and section 13 makes
    // reporting honestly that a Cell could not meet the reason that status exists. A
    // numerator counting only `HELD` would punish the honest report, which is the
    // incentive section 13 is built to remove.
    const month = await thisMonth();
    const firstSaturday = firstSaturdayOf(month);

    await db
      .insertInto('cell_meetings')
      .values({
        cell_id: markCell.id,
        scheduled_date: firstSaturday,
        scheduled_time: '19:00',
        week_starting: mondayOf(firstSaturday),
        reporting_month: month,
        status: 'NOT_HELD',
        not_held_reason: 'LEADER_UNAVAILABLE',
        responsible_leader_id: mark.id,
        // `submitted_by` references `accounts`, not `persons` (migration 0011).
        submitted_by: markAccount.id,
        submitted_at: new Date(),
      })
      .execute();

    const response = await list(markAccount);

    expect(response.body.data[0].coverage).toEqual({
      recorded: 1,
      scheduled: saturdaysIn(month),
    });
  });

  it('reads 0 of 0 for a month in which the Cell had no schedule', async () => {
    // Decision 0225: the line is shown rather than suppressed, and the Cell is not
    // dropped. Reachable here because the Cell did not exist in the month asked about —
    // the same state a month after a closure reaches.
    const young = await createPerson(db, { firstName: 'Yuri', network: 'MENS' });
    await assignTo(db, young.id, manuel.id);
    const youngCell = await createCell(db, {
      leader: young,
      dayOfWeek: 6,
      createdAt: new Date('2026-09-01T10:00:00+08:00'),
    });

    const response = await list(manuelAccount, { month: '2026-08-01' });
    const row = (response.body.data as { id: string; coverage: unknown }[]).find(
      (entry) => entry.id === youngCell.id,
    );

    expect(row).toBeDefined();
    expect(row?.coverage).toEqual({ recorded: 0, scheduled: 0 });
  });

  /**
   * A Cell whose schedule changed effective the first of `JUNE`, staged directly.
   *
   * **June 2026 begins on a Monday**, which is what makes the boundary day itself a
   * scheduled day and the whole class reachable. It holds five Mondays (1, 8, 15, 22, 29)
   * and five Tuesdays (2, 9, 16, 23, 30), so both arms below expect five and a defect
   * shows as six.
   *
   * **A past month, because a month that has not begun now carries no coverage line at
   * all.** The first version of this case asked about October and asserted `scheduled: 5`
   * — which was the `0 of 5` for a month that had not started that the DCC route was
   * refusing to publish in the same commit.
   */
  const JUNE = '2026-06-01';
  const JUNE_FIRST = new Date('2026-05-31T16:00:00Z');

  const cellWithScheduleChange = async (
    from: { dayOfWeek: number; timeOfDay: string },
    to: { dayOfWeek: number; timeOfDay: string } | null,
  ): Promise<TestCell> => {
    const leader = await createPerson(db, { firstName: 'Caleb', network: 'MENS' });
    await assignTo(db, leader.id, manuel.id);

    const cell = await createCell(db, {
      leader,
      dayOfWeek: from.dayOfWeek,
      timeOfDay: from.timeOfDay,
      createdAt: CREATED,
    });

    await db.transaction().execute(async (trx) => {
      if (to !== null) {
        await trx
          .updateTable('cell_schedules')
          .set({ ended_at: JUNE_FIRST })
          .where('cell_id', '=', cell.id)
          .where('ended_at', 'is', null)
          .execute();
      }

      await trx
        .insertInto('cell_schedules')
        .values({
          cell_id: cell.id,
          day_of_week: (to ?? from).dayOfWeek,
          time_of_day: (to ?? from).timeOfDay,
          started_at: JUNE_FIRST,
          // A superseded pending change: closed at its own start, which section 5 makes
          // inert. `changeSchedule` writes exactly this when a leader corrects a queued
          // change inside the same month.
          ended_at: to === null ? JUNE_FIRST : null,
        })
        .execute();
    });

    return cell;
  };

  const scheduledFor = async (cellId: string): Promise<number | undefined> => {
    const response = await list(manuelAccount, { month: JUNE });
    const row = (response.body.data as { id: string; coverage: { scheduled: number } }[]).find(
      (entry) => entry.id === cellId,
    );

    return row?.coverage.scheduled;
  };

  it('counts a time-only schedule change once on the boundary day', async () => {
    // Both rows cover 1 June — the outgoing one ends on it and the incoming one starts on
    // it — and both carry Monday, so the day was derived twice and June held six.
    const cell = await cellWithScheduleChange(
      { dayOfWeek: 1, timeOfDay: '19:00' },
      { dayOfWeek: 1, timeOfDay: '20:00' },
    );

    expect(await scheduledFor(cell.id)).toBe(5);
  });

  it('counts a day-of-week change against the schedule governing each day', async () => {
    // **The arm a deduplication does not reach**, and the one the first fix missed while
    // its docblock said the class was closed. The outgoing Monday row still covers 1 June,
    // which is a Monday, so that day was derived from a schedule no longer in force —
    // alongside all five Tuesdays. Section 10: "a month therefore has exactly one schedule
    // throughout".
    const cell = await cellWithScheduleChange(
      { dayOfWeek: 1, timeOfDay: '19:00' },
      { dayOfWeek: 2, timeOfDay: '19:00' },
    );

    expect(await scheduledFor(cell.id)).toBe(5);
  });

  it('derives nothing from a zero-length schedule row', async () => {
    // Section 5 makes a zero-length row inert — no instant resolves to one — and both a
    // superseded schedule change and a closure write them. The comparisons here are on
    // Manila dates, so such a row still covered its own day: a Monday row inert at 1 June
    // added a sixth meeting to a Cell that meets on Tuesdays.
    const leader = await createPerson(db, { firstName: 'Caleb', network: 'MENS' });
    await assignTo(db, leader.id, manuel.id);
    const cell = await createCell(db, {
      leader,
      dayOfWeek: 2,
      timeOfDay: '19:00',
      createdAt: CREATED,
    });

    await db
      .insertInto('cell_schedules')
      .values({
        cell_id: cell.id,
        day_of_week: 1,
        time_of_day: '20:00',
        started_at: JUNE_FIRST,
        ended_at: JUNE_FIRST,
      })
      .execute();

    expect(await scheduledFor(cell.id)).toBe(5);
  });

  it('refuses a month that has not begun', async () => {
    // Section 20 has a rule for this class and it is a refusal: "a report may not name a
    // period that has not begun" (decision 0216), `VALIDATION_FAILED` naming the period
    // field. A first version of this route answered `200` with a null coverage line, which
    // is a third answer to a settled question — and left the response saying `open: true`
    // about a month that had not started, the state section 20 names as the one its own
    // flag cannot correct.
    //
    // **Derived from the database's day rather than written down.** The first version of
    // this case hard-coded `2026-10-01` as "next month", which stops being next month on
    // 1 October and would then go red for a reason unrelated to any change.
    const now = await databaseNow(db);
    const month = manilaDayOf(new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000));
    const notBegun = `${month.slice(0, 7)}-01`;

    const response = await list(markAccount, { month: notBegun });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('reports the schedule in force now, not a change queued for next month', async () => {
    // A schedule change closes the row in force at a future instant and inserts the
    // replacement **already open** with a future start, so `cell_schedules_one_open` makes
    // the single open row the pending one. Joining on `ended_at is null` therefore reported
    // next month's day and time as the Cell's schedule, beside a coverage line derived from
    // the row actually in force.
    // A Manila month boundary, which migration 0010 requires of a schedule row's start —
    // 16:00 UTC is 00:00 the next day in Manila.
    const queuedFrom = new Date('2098-12-31T16:00:00Z');

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cell_schedules')
        .set({ ended_at: queuedFrom })
        .where('cell_id', '=', markCell.id)
        .where('ended_at', 'is', null)
        .execute();

      await trx
        .insertInto('cell_schedules')
        .values({
          cell_id: markCell.id,
          day_of_week: 3,
          time_of_day: '18:00',
          started_at: queuedFrom,
        })
        .execute();
    });

    const response = await list(markAccount);

    expect(response.body.data[0].schedule).toEqual({ day_of_week: 6, time_of_day: '19:00' });
  });

  it('omits a closed Cell', async () => {
    // Section 10: "every other count of Cells means active Cells". Decision 0226 records
    // that whether a closed Cell should appear is the open question in `CLAUDE.md` about
    // section 7's two readings, and does not settle it; this pins the conservative arm so
    // that settling it has to change a case rather than a silence.
    await closeCellDirectly(db, nathanCell.id, { reason: 'LEADER_STEPPED_DOWN' });

    const response = await list(manuelAccount);

    expect(cellIdsOf(response)).toEqual([manuelCell.id, markCell.id].sort());
  });

  // ---------------------------------------------------------------------------
  // Pagination (section 22)
  // ---------------------------------------------------------------------------

  it('pages by cursor, without repeating or skipping a Cell', async () => {
    const first = await list(manuelAccount, { limit: 2 });

    expect(first.body.data).toHaveLength(2);
    expect(first.body.next_cursor).not.toBeNull();

    const second = await list(manuelAccount, { limit: 2, cursor: first.body.next_cursor });

    expect(second.body.data).toHaveLength(1);
    expect(second.body.next_cursor).toBeNull();

    const seen = [...cellIdsOf(first), ...cellIdsOf(second)].sort();
    expect(seen).toEqual([manuelCell.id, markCell.id, nathanCell.id].sort());
  });

  it('refuses a cursor it cannot read rather than restarting the collection', async () => {
    // Section 22, ruling of 2026-08-31. A client sends a cursor because it already holds
    // a page; handed the first page again under a 200 it appends rows it already has.
    const response = await list(manuelAccount, { cursor: 'not-a-cursor' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.field).toBe('cursor');
  });

  it('refuses a cursor whose decoded key holds text the database cannot store', async () => {
    // Section 22 and decision 0198. The cursor itself is base64url and reaches no column,
    // which is why `storable-text-coverage.spec.ts` exempts the field — the exemption is
    // sound only because the *decoded* key is checked, and a forged cursor carrying a null
    // byte answered 500 on a neighbouring route until that check existed.
    const forged = Buffer.from(
      JSON.stringify({ cellId: `CELL${String.fromCharCode(0)}000001` }),
      'utf8',
    ).toString('base64url');

    const response = await list(manuelAccount, { cursor: forged });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  // ---------------------------------------------------------------------------
  // The month parameter (section 22)
  // ---------------------------------------------------------------------------

  it('requires a month', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cells')
      .set('Authorization', `Bearer ${manuelAccount.accessToken}`);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a well-shaped date that is not a day', async () => {
    // Decision 0185: `2026-02-30` is well-shaped and is not a day, and normalising it
    // rather than refusing it is how an invented date reached a stored record once.
    const response = await request(app.getHttpServer())
      .get('/api/v1/cells')
      .query({ month: '2026-02-30' })
      .set('Authorization', `Bearer ${manuelAccount.accessToken}`);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a led_by it does not offer', async () => {
    // `me` is the only value, and naming a person would be a second way of asking a scope
    // question. Refused at the edge rather than ignored, so a client that meant something
    // is told rather than silently answered its own Cells.
    const response = await list(manuelAccount, { led_by: mark.id });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

/** How many Saturdays a `YYYY-MM-01` month holds, on plain calendar arithmetic. */
function saturdaysIn(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  let count = 0;

  for (let day = 1; day <= 31; day += 1) {
    const at = new Date(Date.UTC(year, monthNumber - 1, day));
    if (at.getUTCMonth() !== monthNumber - 1) {
      break;
    }
    if (at.getUTCDay() === 6) {
      count += 1;
    }
  }

  return count;
}

function firstSaturdayOf(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);

  for (let day = 1; day <= 7; day += 1) {
    const at = new Date(Date.UTC(year, monthNumber - 1, day));
    if (at.getUTCDay() === 6) {
      return at.toISOString().slice(0, 10);
    }
  }

  throw new Error(`No Saturday in the first week of ${month}, which cannot happen.`);
}

/** The Monday of the ISO week a day falls in (section 20). */
function mondayOf(day: string): string {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1, dayOfMonth));
  const isoDay = at.getUTCDay() === 0 ? 7 : at.getUTCDay();

  at.setUTCDate(at.getUTCDate() - (isoDay - 1));

  return at.toISOString().slice(0, 10);
}
