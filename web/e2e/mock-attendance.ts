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
  cell_id: 'C-0007',
  category: 'YOUTH',
  schedule: { day_of_week: 6, time_of_day: '19:00' },
  leader: { person_id: LEADER_ID, member_id: 'M-00412', full_name: 'Teofilo Ramos' },
  coverage: { recorded: 3, scheduled: 4 },
};

/** Decision 0225: it reads `0 of 0`, it is shown, and it is not dropped. */
export const CELL_WITH_NO_SCHEDULE = {
  id: '3f1b7c6e-0000-4000-8000-000000000102',
  cell_id: 'C-0011',
  category: 'COUPLE',
  schedule: { day_of_week: 3, time_of_day: '20:00' },
  leader: { person_id: '3f1b7c6e-0000-4000-8000-000000000202', member_id: 'M-00518', full_name: 'Herminia Lazaro' },
  coverage: { recorded: 0, scheduled: 0 },
};

export async function mockCells(page: Page): Promise<void> {
  await page.route('**/api/v1/cells?*', (route) =>
    route.fulfill(
      json({
        reporting_month: '2026-06-01',
        open: false,
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
        cell_id: 'C-0007',
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

export async function mockDccEvents(page: Page): Promise<void> {
  await page.route('**/api/v1/dcc/events?*', (route) =>
    route.fulfill(
      json({
        reporting_month: '2026-06-01',
        open: true,
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
        cell_id: 'C-0007',
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
            member_id: 'M-00701',
            first_name: 'Rosalinda',
            last_name: 'Ocampo',
            record: null,
          },
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000602',
            member_id: 'M-00702',
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
            member_id: 'M-00701',
            full_name: 'Rosalinda Ocampo',
            responsible_leader_id: LEADER_ID,
            record: { present: true, version: 1, recorded_at: '2026-06-07T12:00:00.000Z' },
          },
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000602',
            member_id: 'M-00702',
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
            member_id: 'M-00701',
            full_name: 'Rosalinda Ocampo',
            started_at: '2026-03-01T00:00:00.000Z',
          },
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000602',
            member_id: 'M-00702',
            full_name: 'Bienvenido Trinidad',
            started_at: '2026-05-12T00:00:00.000Z',
          },
        ],
        next_cursor: null,
      }),
    );
  });
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
            member_id: 'M-00901',
            full_name: 'Consuelo Bautista',
          },
          {
            person_id: '3f1b7c6e-0000-4000-8000-000000000802',
            member_id: 'M-00902',
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
            member_id: 'M-00001',
            full_name: 'Corazon Villanueva',
            network_root: true,
          },
          {
            id: '3f1b7c6e-0000-4000-8000-000000000902',
            member_id: 'M-00044',
            full_name: 'Teofilo Ramos',
            network_root: false,
          },
          {
            id: '3f1b7c6e-0000-4000-8000-000000000601',
            member_id: 'M-00701',
            full_name: 'Rosalinda Ocampo',
            network_root: false,
          },
        ],
        next_cursor: null,
      }),
    ),
  );
}
