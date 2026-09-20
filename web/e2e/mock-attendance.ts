import type { Page } from '@playwright/test';

/**
 * The Cells index, one Cell's meetings, and the DCC calendar, as far as the
 * accessibility sweep is concerned.
 *
 * A companion to `mock-api.ts` rather than part of it: those fixtures are
 * authentication and People, these are attendance, and the two grow at different
 * rates. Everything said there applies here — these are stand-ins for the
 * transport and never for the rules.
 *
 * **The fixtures reach the states worth scanning rather than the tidy ones.**
 * Each carries a row the screen has to handle specially: a Cell that scheduled
 * nothing, which reads `0 of 0` and is shown rather than dropped (decision 0225);
 * a scheduled meeting with no record, which sections 13 and 19 make outstanding
 * work rather than a fourth status; a `NOT_HELD` meeting, which is a record and
 * carries no warning colour; a rescheduled one, which keeps its place in the month
 * because the scheduled date is the identity; a removed Sunday shown in its place
 * with its reason (decision 0227); and a Sunday nobody could have recorded for,
 * whose coverage figure is absent rather than zero (decision 0229).
 *
 * Names and identifiers are invented (`CLAUDE.md`, Secrets).
 */

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

const LEADER_ID = '3f1b7c6e-0000-4000-8000-000000000201';
const SUBMITTER_ID = '3f1b7c6e-0000-4000-8000-000000000401';

export const CELL_WITH_MEETINGS = {
  id: '3f1b7c6e-0000-4000-8000-000000000101',
  cell_id: 'CELL-000007',
  category: 'YOUTH',
  member_count: 6,
  schedule: { day_of_week: 6, time_of_day: '19:00' },
  leader: { person_id: LEADER_ID, member_id: 'M-000412', full_name: 'Teofilo Ramos' },
  coverage: { recorded: 3, scheduled: 4 },
};

/** Decision 0225: it reads `0 of 0`, it is shown, and it is not dropped. */
export const CELL_WITH_NO_SCHEDULE = {
  id: '3f1b7c6e-0000-4000-8000-000000000102',
  cell_id: 'CELL-000011',
  category: 'COUPLE',
  member_count: 4,
  schedule: { day_of_week: 3, time_of_day: '20:00' },
  leader: { person_id: '3f1b7c6e-0000-4000-8000-000000000202', member_id: 'M-000518', full_name: 'Herminia Lazaro' },
  coverage: { recorded: 0, scheduled: 0 },
};

/**
 * Eleven Cells for the coverage table's pager, with the two furthest behind at the end.
 *
 * Section 2 records roughly 800 Cells, so a whole-church coverage table is long. The
 * order matters more than the length: the Cells that have recorded least are the last
 * two, so a table that ranked them would put them first and a test can tell the two
 * apart (sections 13 and 17, decision 0226).
 */
export async function mockCellsAtScale(page: Page): Promise<void> {
  const cells = Array.from({ length: 11 }, (_, index) => ({
    ...CELL_WITH_MEETINGS,
    id: `3f1b7c6e-0000-4000-8000-0000000001${String(index + 10).padStart(2, '0')}`,
    cell_id: `CELL-${String(index + 1).padStart(6, '0')}`,
    // Complete but for the last two, which are the rows a ranked table would lift to
    // the top and this one leaves where the index put them.
    coverage: { recorded: index < 9 ? 4 : 10 - index, scheduled: 4 },
  }));

  await page.route('**/api/v1/cells?*', (route) =>
    route.fulfill(
      json({ reporting_month: '2026-06-01', open: false, data: cells, next_cursor: null }),
    ),
  );
}

/** `open` is the month's submission window, which the Record queue reads for last month. */
export async function mockCells(
  page: Page,
  { open = false }: { open?: boolean } = {},
): Promise<void> {
  await page.route('**/api/v1/cells?*', (route) =>
    route.fulfill(
      json({
        reporting_month: '2026-06-01',
        open,
        data: [CELL_WITH_MEETINGS, CELL_WITH_NO_SCHEDULE],
        next_cursor: null,
      }),
    ),
  );
}

/** A leader who oversees no Cell this month, which is a sentence rather than an error. */
export async function mockCellsEmpty(page: Page): Promise<void> {
  await page.route('**/api/v1/cells?*', (route) =>
    route.fulfill(json({ reporting_month: '2026-06-01', open: false, data: [], next_cursor: null })),
  );
}

export async function mockCellMeetings(page: Page): Promise<void> {
  await page.route('**/api/v1/cells/*/meetings?*', (route) =>
    route.fulfill(
      json({
        cell_id: 'CELL-000007',
        category: 'YOUTH',
        day_of_week: 6,
        scheduled_time: '19:00',
        leader: { id: LEADER_ID, full_name: 'Teofilo Ramos' },
        // Two, which is what `mockCellMembers` pages in full: the count is over the same
        // set, so a complete list of two cannot sit under a count of six.
        member_count: 2,
        cell_closed_on: null,
        reporting_month: '2026-06-01',
        scheduled_count: 4,
        recorded_count: 3,
        meetings: [
          {
            scheduled_date: '2026-06-06',
            scheduled_time: '19:00',
            week_starting: '2026-06-01',
            reporting_month: '2026-06-01',
            meeting: {
              id: '3f1b7c6e-0000-4000-8000-000000000301',
              status: 'HELD',
              scheduled_date: '2026-06-06',
              scheduled_time: '19:00',
              actual_date: null,
              actual_time: null,
              not_held_reason: null,
              not_held_note: null,
              facilitated_by: null,
              responsible_leader_id: LEADER_ID,
              submitted_by: SUBMITTER_ID,
              submitted_at: '2026-06-06T12:00:00.000Z',
              version: 1,
            },
          },
          {
            scheduled_date: '2026-06-13',
            scheduled_time: '19:00',
            week_starting: '2026-06-08',
            reporting_month: '2026-06-01',
            meeting: {
              id: '3f1b7c6e-0000-4000-8000-000000000302',
              status: 'NOT_HELD',
              scheduled_date: '2026-06-13',
              scheduled_time: '19:00',
              actual_date: null,
              actual_time: null,
              not_held_reason: 'OTHER',
              not_held_note: 'The venue was unavailable that evening.',
              facilitated_by: null,
              responsible_leader_id: LEADER_ID,
              submitted_by: SUBMITTER_ID,
              submitted_at: '2026-06-13T12:00:00.000Z',
              version: 1,
            },
          },
          {
            scheduled_date: '2026-06-20',
            scheduled_time: '19:00',
            week_starting: '2026-06-15',
            reporting_month: '2026-06-01',
            meeting: {
              id: '3f1b7c6e-0000-4000-8000-000000000303',
              status: 'RESCHEDULED',
              scheduled_date: '2026-06-20',
              scheduled_time: '19:00',
              actual_date: '2026-06-21',
              actual_time: '16:00',
              not_held_reason: null,
              not_held_note: null,
              facilitated_by: null,
              responsible_leader_id: LEADER_ID,
              submitted_by: SUBMITTER_ID,
              submitted_at: '2026-06-21T12:00:00.000Z',
              version: 2,
            },
          },
          {
            scheduled_date: '2026-06-27',
            scheduled_time: '19:00',
            week_starting: '2026-06-22',
            reporting_month: '2026-06-01',
            meeting: null,
          },
        ],
      }),
    ),
  );
}

/** One row of section 19's recording queue, as `GET /cells/meetings/awaiting` returns it. */
export interface AwaitingRow {
  cell_id: string;
  cell_code: string;
  scheduled_date: string;
  scheduled_time: string;
  reporting_month: string;
  cell_closed_on: string | null;
  day_of_week: number;
  category: 'YOUTH' | 'YOUNG_PRO' | 'COUPLE' | null;
  member_count: number;
  leader: { id: string; full_name: string | null; is_actor: boolean };
  may_record: boolean;
}

/** ISO weekday of a `YYYY-MM-DD` date, 1 = Monday. */
function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();

  return day === 0 ? 7 : day;
}

/** The queue's leader for a row that is the reader's own. */
const OWN = { id: LEADER_ID, full_name: 'Teofilo Ramos', is_actor: true };

/** A meeting of a Cell still `ACTIVE`, which is the ordinary row. */
export function awaitingRow(date: string, month: string, time = '19:00'): AwaitingRow {
  return {
    cell_id: CELL_WITH_MEETINGS.id,
    cell_code: CELL_WITH_MEETINGS.cell_id,
    scheduled_date: date,
    scheduled_time: time,
    reporting_month: month,
    cell_closed_on: null,
    day_of_week: isoWeekday(date),
    category: 'YOUNG_PRO',
    member_count: 5,
    leader: OWN,
    may_record: true,
  };
}

/**
 * A meeting of a Cell that has since **closed**, which is the row this route exists for.
 *
 * The Cells index is `ACTIVE`-only, so no other list names it and no other fixture can
 * stand in for it: a client stitching the Cell's code from the index would find nothing.
 */
export function awaitingClosedRow(date: string, month: string, closedOn: string): AwaitingRow {
  return {
    cell_id: '3f1b7c6e-0000-4000-8000-000000000103',
    cell_code: 'CELL-000014',
    scheduled_date: date,
    scheduled_time: '19:00',
    reporting_month: month,
    cell_closed_on: closedOn,
    day_of_week: isoWeekday(date),
    category: 'YOUTH',
    member_count: 4,
    leader: OWN,
    may_record: true,
  };
}

/**
 * Section 19's recording queue (ruling of 2026-09-17).
 *
 * **Called with no argument it answers every month alike**, which is what the sweep
 * wants: two rows, one of an `ACTIVE` Cell and one of a **closed** one, dated inside
 * whichever month was asked for so neither carries a month tag it should not. The
 * closed row is there rather than for symmetry — its detail line is the longest text
 * a queue row can hold, and 320px is where that has to wrap.
 *
 * **Called with an argument it is keyed by month**, because the Dashboard asks twice in
 * the close week and the two answers differ — that is the whole of what the close-week
 * rule does here. A month the caller does not name then answers shut and empty, which
 * is what section 13 says a month past its 7th owes.
 *
 * The **day bound and the "no record yet" filter are not modelled**, deliberately: the
 * ruling moved both into the route so a client cannot drift from them, and
 * `api/test/api/cell-meetings-awaiting.e2e.spec.ts` is where they are pinned. What these
 * fixtures exercise is the only thing left on this side — that the screen renders the
 * rows it is given, and nothing it is not.
 */
export async function mockMeetingsAwaiting(
  page: Page,
  byMonth?: Record<string, { open?: boolean; meetings?: AwaitingRow[] }>,
): Promise<void> {
  await page.route('**/api/v1/cells/meetings/awaiting?*', (route) => {
    const month = new URL(route.request().url()).searchParams.get('month') ?? '2026-06-01';

    if (byMonth === undefined) {
      const inMonth = (day: string) => `${month.slice(0, 8)}${day}`;
      // The branch view (decision 0258) adds a downline leader's meeting the reader may record.
      const branch =
        new URL(route.request().url()).searchParams.get('whose') === 'branch';

      return route.fulfill(
        json({
          reporting_month: month,
          open: true,
          whose: branch ? 'branch' : 'mine',
          meetings: [
            awaitingRow(inMonth('06'), month),
            awaitingClosedRow(inMonth('13'), month, inMonth('20')),
            ...(branch
              ? [
                  {
                    ...awaitingRow(inMonth('05'), month),
                    cell_id: '3f1b7c6e-0000-4000-8000-000000000104',
                    cell_code: 'CELL-000021',
                    leader: {
                      id: '3f1b7c6e-0000-4000-8000-000000000299',
                      full_name: 'Ana Lim',
                      is_actor: false,
                    },
                    may_record: true,
                  },
                ]
              : []),
          ],
        }),
      );
    }

    const answer = byMonth[month];

    return route.fulfill(
      json({
        reporting_month: month,
        open: answer?.open ?? answer !== undefined,
        whose: 'mine',
        meetings: answer?.meetings ?? [],
      }),
    );
  });
}

export async function mockDccEvents(page: Page, { open = true } = {}): Promise<void> {
  await page.route('**/api/v1/dcc/events?*', (route) =>
    route.fulfill(
      json({
        reporting_month: '2026-06-01',
        open,
        data: [
          {
            id: '3f1b7c6e-0000-4000-8000-000000000501',
            event_date: '2026-06-07',
            recordable: true,
            not_recordable_reason: null,
            removed: false,
            removal_reason: null,
            coverage: { met: 5, owed: 8 },
          },
          {
            id: '3f1b7c6e-0000-4000-8000-000000000502',
            event_date: '2026-06-14',
            recordable: false,
            not_recordable_reason: 'REMOVED',
            removed: true,
            removal_reason: 'The church held a combined regional service.',
            coverage: null,
          },
          {
            id: '3f1b7c6e-0000-4000-8000-000000000503',
            event_date: '2026-06-21',
            recordable: true,
            not_recordable_reason: null,
            removed: false,
            removal_reason: null,
            coverage: { met: 8, owed: 8 },
          },
          {
            id: '3f1b7c6e-0000-4000-8000-000000000504',
            event_date: '2026-06-28',
            recordable: false,
            not_recordable_reason: 'NOT_YET_HELD',
            removed: false,
            removal_reason: null,
            coverage: null,
          },
        ],
      }),
    ),
  );
}

/**
 * One meeting's roster, in the state a correction screen has to handle: some
 * members marked, one not marked at all.
 *
 * The unmarked member is the point. Decision 0223 gives the roster each member's
 * mark so a correction resubmits what is stored, and section 13 has the roster
 * declared rather than inferred — so a member nobody has marked must reach the
 * screen as `null` and not as `present: false`.
 */
export async function mockMeetingRoster(page: Page): Promise<void> {
  await page.route('**/api/v1/cells/*/meetings/*/roster', (route) =>
    route.fulfill(
      json({
        cell_id: 'CELL-000007',
        meeting_id: '2026-06-27',
        scheduled_date: '2026-06-27',
        scheduled_time: '19:00',
        week_starting: '2026-06-22',
        reporting_month: '2026-06-01',
        roster_date: '2026-06-27',
        responsible_leader_id: LEADER_ID,
        meeting: null,
        members: [
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000601',
            member_id: 'M-000701',
            first_name: 'Rosalinda',
            last_name: 'Ocampo',
            record: null,
          },
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000602',
            member_id: 'M-000702',
            first_name: 'Bienvenido',
            last_name: 'Trinidad',
            record: null,
          },
        ],
      }),
    ),
  );
}

/** A leader's DCC checklist: one person recorded already, one not. */
export async function mockDccRoster(page: Page): Promise<void> {
  await page.route('**/api/v1/dcc/events/*/roster', (route) =>
    route.fulfill(
      json({
        event: {
          id: '3f1b7c6e-0000-4000-8000-000000000501',
          event_date: '2026-06-07',
          recordable: true,
          not_recordable_reason: null,
          removed: false,
          removal_reason: null,
          coverage: { met: 5, owed: 8 },
        },
        data: [
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000601',
            member_id: 'M-000701',
            full_name: 'Rosalinda Ocampo',
            responsible_leader_id: LEADER_ID,
            record: { present: true, version: 1, recorded_at: '2026-06-07T12:00:00.000Z' },
          },
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000602',
            member_id: 'M-000702',
            full_name: 'Bienvenido Trinidad',
            responsible_leader_id: LEADER_ID,
            record: null,
          },
        ],
        next_cursor: null,
      }),
    ),
  );
}

/**
 * A meeting already recorded, held or not held: the correction screen's locked states.
 *
 * Held carries a mark for each member, so a locked roster has something to show; not
 * held carries a reason and a note, because section 13 requires the reason and the
 * screen shows both read-only.
 */
export async function mockRecordedMeetingRoster(
  page: Page,
  status: 'HELD' | 'NOT_HELD',
): Promise<void> {
  const held = status === 'HELD';

  await page.route('**/api/v1/cells/*/meetings/*/roster', (route) =>
    route.fulfill(
      json({
        cell_id: 'CELL-000007',
        meeting_id: '2026-06-27',
        scheduled_date: '2026-06-27',
        scheduled_time: '19:00',
        week_starting: '2026-06-22',
        reporting_month: '2026-06-01',
        roster_date: '2026-06-27',
        responsible_leader_id: LEADER_ID,
        meeting: {
          id: '3f1b7c6e-0000-4000-8000-000000000301',
          status,
          scheduled_date: '2026-06-27',
          scheduled_time: '19:00',
          actual_date: null,
          actual_time: null,
          not_held_reason: held ? null : 'WEATHER_OR_CALAMITY',
          not_held_note: held ? null : 'Signal number two was raised that afternoon.',
          facilitated_by: null,
          responsible_leader_id: LEADER_ID,
          submitted_by: SUBMITTER_ID,
          submitted_at: '2026-06-27T13:00:00.000Z',
          version: 3,
        },
        members: [
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000601',
            member_id: 'M-000701',
            first_name: 'Rosalinda',
            last_name: 'Ocampo',
            record: held ? { present: true } : null,
          },
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000602',
            member_id: 'M-000702',
            first_name: 'Bienvenido',
            last_name: 'Trinidad',
            record: held ? { present: false } : null,
          },
        ],
      }),
    ),
  );
}

/** A Sunday whose month has closed: it takes no record, and what was recorded still shows. */
export async function mockClosedDccRoster(page: Page): Promise<void> {
  await page.route('**/api/v1/dcc/events/*/roster', (route) =>
    route.fulfill(
      json({
        event: {
          id: '3f1b7c6e-0000-4000-8000-000000000501',
          event_date: '2026-06-07',
          recordable: false,
          not_recordable_reason: 'MONTH_CLOSED',
          removed: false,
          removal_reason: null,
          coverage: { met: 5, owed: 8 },
        },
        data: [
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000601',
            member_id: 'M-000701',
            full_name: 'Rosalinda Ocampo',
            responsible_leader_id: LEADER_ID,
            record: { present: true, version: 1, recorded_at: '2026-06-07T12:00:00.000Z' },
          },
        ],
        next_cursor: null,
      }),
    ),
  );
}

/**
 * The two monthly reports.
 *
 * **The aggregate arm carries no `n` and no `buckets`**, which is section 12's
 * structural rule rather than an omission: `N` belongs to a Cell, so an aggregate
 * `Completed` would mean "attended everything their own Cell happened to record".
 * The fixture is shaped like the API's own response so the screen is scanned
 * rendering what it will actually receive.
 *
 * The DCC one carries a removed Sunday, because section 9 requires a removal to be
 * named on any report covering the month.
 */
export async function mockCellReport(page: Page): Promise<void> {
  await page.route('**/api/v1/reports/cells/monthly*', (route) =>
    route.fulfill(
      json({
        scope: { kind: 'LEADER', person_id: LEADER_ID },
        period: '2026-06-01',
        open: false,
        unique_people: 9,
        classification: { vip: 2, second_timer: 1, third_timer: 1, fourth_timer: 2, regular: 3 },
        coverage: { recorded: 6, scheduled: 8 },
      }),
    ),
  );
}

/** One Cell, which is the only scope section 12 permits buckets at. */
export async function mockCellReportForOneCell(page: Page): Promise<void> {
  await page.route('**/api/v1/reports/cells/monthly*', (route) =>
    route.fulfill(
      json({
        scope: { kind: 'CELL', cell_id: '3f1b7c6e-0000-4000-8000-000000000101' },
        period: '2026-06-01',
        open: false,
        n: 3,
        unique_people: 4,
        classification: { vip: 1, second_timer: 1, third_timer: 0, fourth_timer: 0, regular: 2 },
        buckets: [
          { times: 1, people: 1, completed: false },
          { times: 2, people: 2, completed: false },
          { times: 3, people: 1, completed: true },
        ],
        coverage: { recorded: 3, scheduled: 4 },
      }),
    ),
  );
}

export async function mockDccReport(page: Page): Promise<void> {
  await page.route('**/api/v1/reports/dcc/monthly*', (route) =>
    route.fulfill(
      json({
        scope: { kind: 'LEADER', person_id: LEADER_ID },
        period: '2026-06-01',
        open: false,
        n: 3,
        removed_events: ['2026-06-14'],
        unique_people: 7,
        classification: { vip: 1, second_timer: 2, third_timer: 1, fourth_timer: 1, regular: 2 },
        buckets: [
          { times: 1, people: 2, completed: false },
          { times: 2, people: 3, completed: false },
          { times: 3, people: 2, completed: true },
        ],
        coverage: { met: 12, owed: 18 },
      }),
    ),
  );
}

/**
 * A Cell's current members.
 *
 * Two rows and no next page, which is what a real Cell looks like at this church's
 * scale. `started_at` is what the screen reads a "member since" date from, and it
 * is why removing somebody does not erase the months they were counted in.
 */
export async function mockCellMembers(page: Page): Promise<void> {
  await page.route('**/api/v1/cells/*/members**', (route) => {
    if (route.request().method() !== 'GET') {
      return route.fulfill({ status: 204, body: '' });
    }

    return route.fulfill(
      json({
        data: [
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000601',
            member_id: 'M-000701',
            full_name: 'Rosalinda Ocampo',
            started_at: '2026-03-01T00:00:00.000Z',
          },
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000602',
            member_id: 'M-000702',
            full_name: 'Bienvenido Trinidad',
            started_at: '2026-05-12T00:00:00.000Z',
          },
        ],
        next_cursor: null,
      }),
    );
  });
}

/**
 * The same Cell after it was closed (section 10). Closure ends the schedule and every
 * membership, so the month holds no scheduled meeting and the count is zero: the screens
 * read `cell_closed_on` to say so rather than showing an empty list with no reason.
 */
export async function mockClosedCellMeetings(page: Page): Promise<void> {
  await page.route('**/api/v1/cells/*/meetings?*', (route) =>
    route.fulfill(
      json({
        cell_id: 'CELL-000007',
        category: 'YOUTH',
        day_of_week: 6,
        scheduled_time: '19:00',
        leader: { id: LEADER_ID, full_name: 'Teofilo Ramos' },
        member_count: 0,
        cell_closed_on: '2026-06-20',
        reporting_month: '2026-06-01',
        scheduled_count: 0,
        recorded_count: 0,
        meetings: [],
      }),
    ),
  );
}

/** A Cell with nobody in it, which is a sentence rather than an error. */
export async function mockCellMembersEmpty(page: Page): Promise<void> {
  await page.route('**/api/v1/cells/*/members**', (route) =>
    route.fulfill(json({ data: [], next_cursor: null })),
  );
}

/** Who still owes a record for one Sunday (decision 0228). */
export async function mockCoverageGaps(page: Page): Promise<void> {
  await page.route('**/api/v1/dcc/events/*/coverage-gaps*', (route) =>
    route.fulfill(
      json({
        event: {
          id: '3f1b7c6e-0000-4000-8000-000000000501',
          event_date: '2026-06-07',
          recordable: true,
          not_recordable_reason: null,
          removed: false,
          removal_reason: null,
          coverage: { met: 5, owed: 8 },
        },
        data: [
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000801',
            member_id: 'M-000901',
            full_name: 'Consuelo Bautista',
          },
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000802',
            member_id: 'M-000902',
            full_name: 'Ferdinand Salazar',
          },
        ],
        next_cursor: null,
      }),
    ),
  );
}

/**
 * A pastoral path that reaches a Network root.
 *
 * The root flag is on the first entry only, which is what decision 0131 makes the
 * chain say about itself: a path that stopped short would otherwise read the same
 * as one that reached the top.
 */
export async function mockPastoralPath(page: Page): Promise<void> {
  await page.route('**/api/v1/people/*/pastoral-path*', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: '3f1b7c6e-0000-4000-8000-000000000901',
            member_id: 'M-000001',
            full_name: 'Corazon Villanueva',
            network_root: true,
          },
          {
            id: '3f1b7c6e-0000-4000-8000-000000000902',
            member_id: 'M-000044',
            full_name: 'Teofilo Ramos',
            network_root: false,
          },
          {
            id: '3f1b7c6e-0000-4000-8000-000000000601',
            member_id: 'M-000701',
            full_name: 'Rosalinda Ocampo',
            network_root: false,
          },
        ],
        next_cursor: null,
      }),
    ),
  );
}

/**
 * A one-entry pastoral path whose single entry holds a root seat.
 *
 * **The case that broke the chain, kept so it cannot break again.** A Network root has
 * nobody above them, and rendering that fact as a chain entry produced
 * `Network root › You` — which tells the person reading it that somebody is above them
 * when they are the root. Only `network_root` tells this apart from a Person with no
 * leader at all (decision 0131), so both readings are exercised rather than one.
 */
export async function mockPastoralPathAtRoot(page: Page): Promise<void> {
  await page.route('**/api/v1/people/*/pastoral-path*', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9',
            member_id: 'M-000001',
            full_name: 'Marilou Reyes Santos',
            network_root: true,
          },
        ],
        next_cursor: null,
      }),
    ),
  );
}

/**
 * The Network screen's routes (decision 0252): the branch, and the two figure routes.
 *
 * **The first page carries a cursor and the second does not**, so `Show 20 more` renders,
 * is measured for target size, and stops rather than paging for ever. The API refuses
 * `?cursor=` outright, so the absence of the parameter is what marks the first page.
 *
 * The figures add up, as the API's do: the focus person's branch equals their own gap
 * plus each row's. Invented names throughout.
 */
export async function mockNetworkTree(page: Page): Promise<void> {
  const node = (id: string, member: string, name: string, direct: number, beneath: number) => ({
    id,
    member_id: member,
    full_name: name,
    leads_anyone: direct > 0,
    direct_reports: direct,
    beneath,
  });

  const self = node('9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9', 'M-000042', 'Marilou Reyes Santos', 3, 9);
  const consuelo = node('3f1b7c6e-0000-4000-8000-000000000701', 'M-000801', 'Consuelo Bautista', 1, 4);
  const efren = node('3f1b7c6e-0000-4000-8000-000000000702', 'M-000802', 'Efren Dimaculangan', 0, 0);
  const lourdes = node('3f1b7c6e-0000-4000-8000-000000000703', 'M-000803', 'Lourdes Magsaysay', 0, 0);
  const teresita = node('3f1b7c6e-0000-4000-8000-000000000704', 'M-000804', 'Teresita Alcantara', 0, 3);

  await page.route('**/api/v1/network/my-tree*', (route) => {
    const paged = route.request().url().includes('cursor=');

    return route.fulfill(
      json({
        person: self,
        data: paged ? [lourdes] : [consuelo, efren],
        next_cursor: paged ? null : 'example-children-cursor',
      }),
    );
  });

  // Consuelo's own path, so the breadcrumb one generation down reads Marilou › Consuelo.
  await page.route(`**/api/v1/people/${consuelo.id}/pastoral-path*`, (route) =>
    route.fulfill(
      json({
        data: [
          { id: self.id, member_id: self.member_id, full_name: self.full_name, network_root: true },
          { id: consuelo.id, member_id: consuelo.member_id, full_name: consuelo.full_name, network_root: false },
        ],
        next_cursor: null,
      }),
    ),
  );

  await page.route('**/api/v1/leaders/*/children*', (route) =>
    route.fulfill(json({ person: consuelo, data: [teresita], next_cursor: null })),
  );

  await page.route('**/api/v1/leaders/*/dcc-behind', (route) =>
    route.fulfill(
      json({
        reporting_month: '2026-09-01',
        open: true,
        branch_behind: 4,
        behind_by_child: { [consuelo.id]: 3, [efren.id]: 0, [lourdes.id]: 1, [teresita.id]: 2 },
      }),
    ),
  );

  await page.route('**/api/v1/leaders/*/cell-figures', (route) =>
    route.fulfill(
      json({
        reporting_month: '2026-09-01',
        open: true,
        cell_leaders_beneath: 2,
        branch_meetings_behind: 1,
        meetings_behind_by_child: {
          [consuelo.id]: 1,
          [efren.id]: 0,
          [lourdes.id]: 0,
          [teresita.id]: 0,
        },
      }),
    ),
  );
}

/**
 * The signed-in leader as the Network screen needs them: reading DCC and Cell figures and
 * holding the reassignment capability, so the figures and the Move controls render.
 */
export async function mockNetworkReader(page: Page): Promise<void> {
  const grant = (capability: string) => ({
    capability,
    scope_type: 'OWN_SUBTREE',
    scope_network: null,
    read_only: false,
    source: 'ROLE',
  });

  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill(
      json({
        account_id: '4f8c1d6a-0f1e-4b2a-9c3d-5e6f7a8b9c0d',
        person_id: '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9',
        email: 'leader@example.invalid',
        first_name: 'Marilou',
        roles: ['LEADER'],
        capabilities: [
          grant('people.view_subtree'),
          grant('dcc.view_subtree'),
          grant('cell.view_subtree'),
          grant('people.manage_pastoral_assignment'),
        ],
      }),
    ),
  );
}

/**
 * A report's coverage by leader, for either report (decision 0254). Two named rows — the
 * reader first — and the unnamed line, adding up to the total. Invented names.
 */
export async function mockCoverageByLeader(page: Page): Promise<void> {
  const body = {
    period: '2026-06-01',
    open: true,
    data: [
      {
        leader: {
          id: '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9',
          member_id: 'M-000042',
          full_name: 'Marilou Reyes Santos',
        },
        filed: 4,
        owed: 4,
      },
      {
        leader: {
          id: '3f1b7c6e-0000-4000-8000-000000000701',
          member_id: 'M-000801',
          full_name: 'Consuelo Bautista',
        },
        filed: 5,
        owed: 8,
      },
    ],
    others: { filed: 3, owed: 6 },
    total: { filed: 12, owed: 18 },
    next_cursor: null,
  };

  await page.route('**/api/v1/reports/*/monthly/by-leader*', (route) => route.fulfill(json(body)));
}
