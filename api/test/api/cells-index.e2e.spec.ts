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
