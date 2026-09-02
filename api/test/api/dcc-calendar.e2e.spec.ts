import { sql, type Kysely } from 'kysely';

import { createTestDb, truncateAll } from '../setup/database';
import { createTestApp } from '../setup/fixtures';
import { DccCalendarService } from '../../src/attendance/dcc-calendar.service';
import { manilaDayOf } from '../../src/common/time/manila';
import { reportingMonthOf, windowClosesAt } from '../../src/common/time/submission-window';

import type { INestApplication } from '@nestjs/common';
import type { Database } from '../../src/database/schema';

/**
 * The DCC calendar generation command (SKILL.md section 9).
 *
 * Every rule section 9 states about generation, exercised against the database —
 * because each of them is a sentence that would otherwise have nothing able to fail
 * on it, and because two of them are rules the specification arrived at only after
 * the mechanism they replaced was withdrawn (decisions 0165, 0168).
 *
 * **These run against real dates rather than a frozen clock.** The service reads its
 * instant from the database (decision 0160) and there is no seam to inject one, on
 * purpose: a caller that can pass its own instant is a caller that will, and the
 * host clock is the wrong one. So the cases assert relationships — this Sunday is
 * present, that month was not filled, the horizon is at least this far — rather
 * than literal dates, which is what makes them true next year as well as today.
 */
describe('the DCC calendar (SKILL.md section 9)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let calendar: DccCalendarService;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
    calendar = app.get(DccCalendarService);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const events = (): Promise<{ event_date: string }[]> =>
    db.selectFrom('dcc_events').select('event_date').orderBy('event_date').execute();

  it('creates one event per Sunday and nothing else', async () => {
    // Section 9: "exactly one applicable DCC event per Sunday, church-wide". The
    // check constraint refuses any other day, so what this adds is that the command
    // does not skip Sundays — the constraint cannot catch an under-generation.
    const run = await calendar.generate();
    const rows = await events();

    expect(rows.length).toBe(run.created.length);
    expect(rows.length).toBeGreaterThan(50);

    for (const row of rows) {
      // ISO day 7. Read off the date rather than a local weekday, which would answer
      // in whatever zone the test process runs in.
      const [y, m, d] = row.event_date.split('-').map(Number);
      expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay()).toBe(0);
    }

    // Consecutive, with no gap: every seventh day from the first to the last.
    for (let i = 1; i < rows.length; i += 1) {
      const previous = Date.parse(`${rows[i - 1].event_date}T00:00:00Z`);
      const current = Date.parse(`${rows[i].event_date}T00:00:00Z`);
      expect(current - previous).toBe(7 * 86_400_000);
    }
  });

  it('reaches thirteen months ahead, clear of section 9 twelve-month floor', async () => {
    // The floor is "at least twelve months"; the target is thirteen, because a
    // top-up *to* the floor satisfies it at the instant it runs and at no instant
    // afterwards (ruling of 2026-08-31).
    const run = await calendar.generate();
    const today = manilaDayOf(new Date());

    const twelveMonthsOut = new Date(today);
    twelveMonthsOut.setUTCMonth(twelveMonthsOut.getUTCMonth() + 12);

    expect(run.horizon).not.toBeNull();
    expect(run.horizon! > manilaDayOf(twelveMonthsOut)).toBe(true);
    expect(run.belowFloor).toBe(false);
  });

  it('is idempotent: a second run creates nothing', async () => {
    // Section 9 leans this on the unique index rather than on the command checking
    // first, so that two racing runs are safe too — but a command that re-inserted
    // every Sunday and swallowed the conflict would also be "idempotent" while
    // writing an audit entry per Sunday per run. This asserts it creates nothing.
    await calendar.generate();
    const second = await calendar.generate();

    expect(second.created).toEqual([]);

    const entries = await db
      .selectFrom('audit_log')
      .select('id')
      .where('action', '=', 'dcc_event.created')
      .execute();

    const rows = await events();
    expect(entries.length).toBe(rows.length);
  });

  it('never revives a Sunday an Admin removed', async () => {
    // Section 9's whole removal design: a removed event keeps its row, so a month
    // showing four events where the calendar holds five is explained by a record.
    // A generation that treated a removed Sunday as missing would undo an audited
    // decision on the next schedule tick, silently.
    await calendar.generate();

    const target = (await events())[10].event_date;
    const account = await anAccount();

    await db
      .updateTable('dcc_events')
      .set({ removed_at: new Date(), removed_by: account, removal_reason: 'Typhoon.' })
      .where('event_date', '=', target)
      .execute();

    const second = await calendar.generate();

    expect(second.created).toEqual([]);

    const row = await db
      .selectFrom('dcc_events')
      .select(['removed_at', 'removal_reason'])
      .where('event_date', '=', target)
      .executeTakeFirstOrThrow();

    expect(row.removed_at).not.toBeNull();
    expect(row.removal_reason).toBe('Typhoon.');
  });

  it('fills a gap inside an open month', async () => {
    // The half of the repair that survived decision 0168. Within an open month the
    // window is open, leaders can still submit, and the event counts in N and in
    // coverage exactly as one generated on time.
    //
    // **The gap is built rather than punched.** A first version deleted an event and
    // met the no-delete trigger, which is section 9's design working: a removed
    // Sunday keeps its row precisely so a month is never quietly short. So the state
    // is assembled instead — a calendar start, one Sunday present, and the Sunday
    // before it absent — which is what a lapse actually leaves behind.
    const start = sundayInThisMonth();
    await setCalendarStart(start);

    const second = addDays(start, 7);
    await db.insertInto('dcc_events').values({ event_date: second }).execute();

    const run = await calendar.generate();

    // The gap before it was filled, and the Sunday already present was not touched.
    expect(run.created).toContain(start);
    expect(run.created).not.toContain(second);
  });

  it('reports a closed month that is short, and changes nothing', async () => {
    // **The rule decision 0168 arrived at by withdrawing its opposite.** An event
    // added to a month whose window has shut is one no leader was ever able to
    // submit against, so every leader reads as having failed to record for it — and
    // it would move that month's N and every bucket derived from it, for a period
    // already reported.
    await calendar.generate();

    // A Sunday in a month whose window has certainly shut. The calendar starts at
    // the Sunday on or before today, so the earliest event is at most six days old
    // and its month may still be open; go back far enough to be sure by seeding one.
    const longAgo = '2026-01-04'; // a Sunday, and its window shut on 2026-02-07
    expect(windowClosesAt('2026-01-01').getTime()).toBeLessThan(Date.now());

    await setCalendarStart(longAgo);

    const run = await calendar.generate();

    expect(run.closedMonthsShort).toContain('2026-01-01');

    // Nothing was created in that month.
    const january = (await events()).filter((row) => row.event_date.startsWith('2026-01'));
    expect(january).toEqual([]);
  });

  it('sets the calendar start on its first run and never moves it', async () => {
    // Seeded null, set once, to the Sunday on or before that day (ruling of
    // 2026-08-31). It records when this church's calendar began, which is what lets
    // a report over an earlier range say "before we started" rather than "no
    // service".
    const before = await db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'dcc_calendar_start')
      .executeTakeFirstOrThrow();

    expect(before.value).toBeNull();

    const first = await calendar.generate();
    expect(first.calendarStart).not.toBeNull();

    // A Sunday, and not in the future.
    expect(first.calendarStart! <= manilaDayOf(new Date())).toBe(true);
    const [y, m, d] = first.calendarStart!.split('-').map(Number);
    expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay()).toBe(0);

    const second = await calendar.generate();
    expect(second.calendarStart).toBeNull();

    const after = await db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'dcc_calendar_start')
      .executeTakeFirstOrThrow();

    expect(after.value).toBe(first.calendarStart);
  });

  it('leaves a start that was already set where it is, even a much older one', async () => {
    // **The half the case above cannot see, and a mutation proved it.** Both runs
    // there compute the same Sunday, so a service that rewrote the key on every run
    // would write the identical value and pass. What the rule actually protects is a
    // start somebody set earlier: rewriting it forward would silently redefine when
    // this church's calendar began, and every "before we started" answer with it.
    const ancient = '2020-01-05'; // a Sunday
    await setCalendarStart(ancient);

    const run = await calendar.generate();

    // Reported as unset by this run, because it was not this run that set it.
    expect(run.calendarStart).toBeNull();

    const after = await db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'dcc_calendar_start')
      .executeTakeFirstOrThrow();

    expect(after.value).toBe(ancient);
  });

  it('reaches back to the calendar start and no further', async () => {
    // Without a floor, "a Sunday it finds missing" reaches the epoch. The key is
    // what makes "missing" mean something exact.
    await calendar.generate();

    const earliest = (await events())[0].event_date;
    const start = await db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'dcc_calendar_start')
      .executeTakeFirstOrThrow();

    expect(earliest).toBe(start.value);
  });

  it('writes one audit entry per event created, as a system action', async () => {
    // Section 21 requires a target and one entry per action performed. The actor is
    // null because the command is invoked by a schedule and has no interactive one,
    // which section 6 names as one of two things permitted to write that null.
    const run = await calendar.generate();

    const entries = await db
      .selectFrom('audit_log')
      .select(['actor_id', 'target_type', 'target_id'])
      .where('action', '=', 'dcc_event.created')
      .execute();

    expect(entries.length).toBe(run.created.length);
    expect(entries.every((entry) => entry.actor_id === null)).toBe(true);
    expect(entries.every((entry) => entry.target_type === 'dcc_event')).toBe(true);
    expect(new Set(entries.map((entry) => entry.target_id))).toEqual(new Set(run.created));
  });

  it('writes no audit entry on a run that creates nothing', async () => {
    await calendar.generate();

    const before = await db
      .selectFrom('audit_log')
      .select(db.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();

    await calendar.generate();

    const after = await db
      .selectFrom('audit_log')
      .select(db.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();

    expect(after.n).toBe(before.n);
  });

  /** `settings.value` is `jsonb`, so a date goes in as a JSON string. */
  async function setCalendarStart(day: string): Promise<void> {
    await sql`
      UPDATE settings SET value = to_jsonb(${day}::text) WHERE key = 'dcc_calendar_start'
    `.execute(db);
  }

  /** A Sunday inside the current Manila month, which is open by definition. */
  function sundayInThisMonth(): string {
    const month = reportingMonthOf(manilaDayOf(new Date()));
    let day = month;

    while (isoDay(day) !== 7) {
      day = addDays(day, 1);
    }

    return day;
  }

  function addDays(day: string, days: number): string {
    const [y, m, d] = day.split('-').map(Number);
    const at = new Date(Date.UTC(y, m - 1, d + days));

    return `${String(at.getUTCFullYear()).padStart(4, '0')}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(at.getUTCDate()).padStart(2, '0')}`;
  }

  function isoDay(day: string): number {
    const [y, m, d] = day.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    return weekday === 0 ? 7 : weekday;
  }

  async function anAccount(): Promise<string> {
    const person = await db
      .insertInto('persons')
      .values({
        first_name: 'Calendar',
        last_name: 'Admin',
        sex: 'MALE',
        civil_status: 'SINGLE',
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow();

    const account = await db
      .insertInto('accounts')
      .values({
        person_id: person.id,
        email: 'calendar@example.test',
        email_normalized: 'calendar@example.test',
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow();

    return account.id;
  }
});
