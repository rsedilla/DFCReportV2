import { expect, test, type Page } from '@playwright/test';

import {
  mockAwaitingReassignment,
  mockCellCorrector,
  mockGrants,
  mockPeopleWithoutACell,
  mockSignedIn,
} from './mock-api';
import {
  awaitingClosedRow,
  awaitingRow,
  mockCellMeetings,
  mockCellReport,
  mockCells,
  mockClosedDccRoster,
  mockDccEvents,
  mockDccReport,
  mockDccRoster,
  mockMeetingRoster,
  mockMeetingsAwaiting,
  mockRecordedMeetingRoster,
} from './mock-attendance';

/**
 * What the recording screens let a leader do, as opposed to what they look like.
 *
 * `accessibility.spec.ts` scans these states for conformance and target size, and
 * neither of those can tell whether a recorded meeting is locked, whether the edit is
 * offered to the right account, or whether last month's open work reaches the queue.
 * These cases pin that behaviour, each against the rule it follows.
 */

const MEETING = '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings/2026-06-27';

test.describe('a recorded Cell meeting', () => {
  // Decision 0246: every account the roster admits reads the marks; changing them
  // needs `cell.correct_subtree`. The shared account holds no Cell capability.
  test('shows its marks locked, and offers no edit to an account that may not correct it', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockRecordedMeetingRoster(page, 'HELD');

    await page.goto(MEETING);

    await expect(page.getByText('Already recorded')).toBeVisible();
    await expect(page.getByText('needs permission to correct records')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit this record' })).toHaveCount(0);

    const present = page.getByRole('radio', { name: 'Present' }).first();
    await expect(present).toBeChecked();
    await expect(present).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
  });

  test('unlocks its marks for an account that may correct it, keeping the recorded status', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellCorrector(page);
    await mockRecordedMeetingRoster(page, 'HELD');

    await page.goto(MEETING);
    await page.getByRole('button', { name: 'Edit this record' }).click();

    await expect(page.getByRole('radio', { name: 'Present' }).first()).toBeEnabled();
    await expect(page.getByLabel('Why is this changing? (optional)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save the correction' })).toBeVisible();

    // Decision 0195 admits no move between met and did not meet, so a correction does
    // not offer one.
    await expect(page.getByRole('radio', { name: 'Did not meet' })).toHaveCount(0);
  });

  test('recorded as did not meet is shown with its reason, and offers no edit', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellCorrector(page);
    await mockRecordedMeetingRoster(page, 'NOT_HELD');

    await page.goto(MEETING);

    await expect(page.getByText('Why: Weather or calamity')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit this record' })).toHaveCount(0);
  });
});

// Decision 0238: a Cell meeting takes no record before its day has begun, so the screen
// offers none rather than a Save the API would refuse.
test('a meeting whose day has not come offers no marks and no Save', async ({ page }) => {
  // 10:00 on 20 June in Manila, a week before the meeting.
  await page.clock.setFixedTime(new Date('2026-06-20T02:00:00Z'));
  await mockSignedIn(page);
  await mockMeetingRoster(page);

  await page.goto(MEETING);

  await expect(page.getByText('Not yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Present' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
});

test('a Sunday that takes no record still shows what was recorded, and cannot be changed', async ({
  page,
}) => {
  await mockSignedIn(page);
  await mockClosedDccRoster(page);

  await page.goto('/dcc/3f1b7c6e-0000-4000-8000-000000000501');

  const present = page.getByRole('radio', { name: 'Present' }).first();
  await expect(present).toBeChecked();
  await expect(present).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
});

// Changing a recorded DCC mark is a correction, which the API refuses without
// `dcc.correct_subtree`, so the checklist locks recorded marks the way the Cell meeting
// screen locks a recorded meeting. In the fixture one person is recorded and one is not.
test.describe('a Sunday with a mark already recorded', () => {
  const SUNDAY = '/dcc/3f1b7c6e-0000-4000-8000-000000000501';
  const RECORDED = { id: '3f1b7c6e-0000-4000-8000-000000000601', name: 'Rosalinda Ocampo' };
  const UNRECORDED = { id: '3f1b7c6e-0000-4000-8000-000000000602', name: 'Bienvenido Trinidad' };

  test('locks the recorded mark, and says before Save that this account may not change it', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockDccRoster(page);

    await page.goto(SUNDAY);

    await expect(page.getByText('Already recorded: 1 person')).toBeVisible();
    await expect(
      page.getByText('Changing a recorded mark needs permission to correct records'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change recorded marks' })).toHaveCount(0);

    const recorded = page.getByRole('group', { name: RECORDED.name }).getByRole('radio', {
      name: 'Present',
    });
    await expect(recorded).toBeChecked();
    await expect(recorded).toBeDisabled();
    await expect(
      page.getByRole('group', { name: UNRECORDED.name }).getByRole('radio', { name: 'Present' }),
    ).toBeEnabled();
  });

  test('unlocks it for an account that may correct, sending the reason only with the changed mark', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockGrants(page, ['dcc.correct_subtree']);
    await mockDccRoster(page);

    const sent: unknown[] = [];
    await page.route('**/api/v1/dcc/events/*/submit', async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto(SUNDAY);
    await page.getByRole('button', { name: 'Change recorded marks' }).click();

    await page
      .getByRole('group', { name: RECORDED.name })
      .getByRole('radio', { name: 'Absent' })
      .check();
    await page
      .getByRole('group', { name: UNRECORDED.name })
      .getByRole('radio', { name: 'Present' })
      .check();
    await page.getByLabel('Why is this changing? (optional)').fill('Marked the wrong person');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({
      records: [
        {
          person_id: RECORDED.id,
          present: false,
          version: 1,
          correction_reason: 'Marked the wrong person',
        },
        { person_id: UNRECORDED.id, present: true, version: null },
      ],
    });
  });
});

/**
 * Section 19's queue, since the ruling of 2026-09-17 moved its Cell half onto a route
 * of its own.
 *
 * **What is testable here shrank, and deliberately.** The day bound, the "no record
 * yet" filter and which leader a meeting belongs to are the route's now, pinned in
 * `api/test/api/cell-meetings-awaiting.e2e.spec.ts`. Asserting them again through a
 * mock would assert the mock. What is left is this screen's own: that it renders the
 * rows it is given, says why a closed Cell is there, links to a meeting that is
 * reachable, and never reports an empty queue it did not actually read.
 */
test.describe('the Record queue', () => {
  const CLOSED_CELL = '3f1b7c6e-0000-4000-8000-000000000103';

  async function mockRecordScreen(
    page: Page,
    awaiting?: Parameters<typeof mockMeetingsAwaiting>[1],
  ) {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellMeetings(page);
    await mockMeetingsAwaiting(page, awaiting);
    await mockCellReport(page);
    await mockDccReport(page);
    await mockDccEvents(page);
    await mockDccRoster(page);
    await mockAwaitingReassignment(page);
    await mockPeopleWithoutACell(page);
  }

  // Section 13 keeps a month open through its 7th and has every leader see their own
  // outstanding work always, so last month's open Sundays are listed until then. The
  // DCC mocks answer every month alike and mark the events open and recordable.
  test('lists last month’s open work in the first seven days, with the day it closes', async ({
    page,
  }) => {
    // 10:00 on 3 October in Manila.
    await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
    await mockRecordScreen(page, {});

    await page.goto('/dashboard');

    await expect(page.getByText('September · open until 7 Oct').first()).toBeVisible();
  });

  test('lists nothing from last month once the 7th has passed', async ({ page }) => {
    // 10:00 on 8 October in Manila.
    await page.clock.setFixedTime(new Date('2026-10-08T02:00:00Z'));
    await mockRecordScreen(page, {});

    await page.goto('/dashboard');

    // This month's rows have arrived, so an absence below is not a page still loading.
    await expect(page.getByRole('link', { name: /^Record DCC,/ }).first()).toBeVisible();
    await expect(page.getByText('open until 7 Oct')).toHaveCount(0);
  });

  // The Cell half of the same rule. The month the route is asked about is the month it
  // answers for, so last month's meetings arrive under last month's tag.
  test('lists last month’s Cell meetings in the first seven days, tagged with last month', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
    await mockRecordScreen(page, {
      '2026-10-01': { meetings: [] },
      '2026-09-01': { meetings: [awaitingRow('2026-09-26', '2026-09-01')] },
    });

    await page.goto('/dashboard');
    await page.getByRole('radio', { name: 'Cells', exact: true }).check();

    await expect(page.getByRole('link', { name: /^Record C-0007,/ })).toBeVisible();
    await expect(page.getByText('September · open until 7 Oct').first()).toBeVisible();
  });

  // A month past its 7th answers shut and empty rather than refusing, so the screen has
  // nothing to decide: it lists what it was given, which is nothing.
  test('lists no Cell meeting from a month the server has shut', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
    await mockRecordScreen(page, {
      '2026-10-01': { meetings: [awaitingRow('2026-10-03', '2026-10-01')] },
      '2026-09-01': { open: false, meetings: [] },
    });

    await page.goto('/dashboard');
    await page.getByRole('radio', { name: 'Cells', exact: true }).check();

    // October's row has arrived, so an absence below is not a page still loading.
    await expect(page.getByRole('link', { name: /^Record C-0007,/ })).toBeVisible();
    await expect(page.getByText('open until 7 Oct')).toHaveCount(0);
  });

  /**
   * The gap this route was written to close (section 19, ruling of 2026-09-17).
   *
   * A Cell closed part-way through a month keeps meetings its leader still owes a
   * record for, and the Cells index is `ACTIVE`-only — so before this route the row
   * could not be rendered at all. The Cell's code comes from the queue rather than
   * from the index, which is why a closed Cell can be named here and nowhere else.
   */
  test('names a closed Cell’s meeting, says in words that the Cell closed, and links to it', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
    await mockRecordScreen(page, {
      '2026-10-01': {
        meetings: [awaitingClosedRow('2026-10-03', '2026-10-01', '2026-09-20')],
      },
    });

    await page.goto('/dashboard');
    await page.getByRole('radio', { name: 'Cells', exact: true }).check();

    // Exact, because the Record button's accessible name names the Cell too.
    await expect(page.getByText('Youth · Saturdays 7:00 pm', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Saturday 3 October · You · 4 members · C-0014 · Cell closed Sunday 20 September'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /^Record C-0014,/ })).toHaveAttribute(
      'href',
      `/cells/${CLOSED_CELL}/meetings/2026-10-03`,
    );
  });

  // Sections 13, 17 and 19 refuse to encode a record's state in colour, and a closed
  // Cell is a state. The words carry it, so the row is neither tagged nor tinted
  // differently from the Cell beside it that is still open.
  test('marks a closed Cell no differently from an open one but for the words', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
    await mockRecordScreen(page, {
      '2026-10-01': {
        meetings: [
          awaitingRow('2026-10-03', '2026-10-01'),
          awaitingClosedRow('2026-10-03', '2026-10-01', '2026-09-20'),
        ],
      },
    });

    await page.goto('/dashboard');
    await page.getByRole('radio', { name: 'Cells', exact: true }).check();

    const rows = page.locator('li', { has: page.getByRole('link', { name: /^Record C-/ }) });
    await expect(rows).toHaveCount(2);

    // The only tag either row carries is the one both carry.
    for (const row of await rows.all()) {
      await expect(row.getByText('Awaiting a record')).toBeVisible();
    }
    await expect(page.getByText('Cell closed')).toHaveCount(1);
  });

  // An open Cell's row says the time and stops there: the closure sentence is not a
  // label every row wears with an empty value.
  test('says only the time for a Cell that is still open', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
    await mockRecordScreen(page, {
      '2026-10-01': { meetings: [awaitingRow('2026-10-03', '2026-10-01')] },
    });

    await page.goto('/dashboard');
    await page.getByRole('radio', { name: 'Cells', exact: true }).check();

    await expect(page.getByText('Saturday 3 October · You · 5 members · C-0007')).toBeVisible();
    await expect(page.getByText('Cell closed')).toHaveCount(0);
  });

  // The queue is empty when the route says it is, and says so in a sentence rather
  // than by rendering nothing.
  test('says no Cell meeting is awaiting a record when the route returns none', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
    await mockRecordScreen(page, { '2026-10-01': { meetings: [] } });

    await page.goto('/dashboard');
    await page.getByRole('radio', { name: 'Cells', exact: true }).check();

    await expect(page.getByText('No Cell meeting of yours is awaiting a record.')).toBeVisible();
  });

  /**
   * A read that failed must never render as "nothing to do" (section 19).
   *
   * This is the assertion that matters most after the ruling: the queue's Cell half is
   * now **one** request, so one refusal empties it completely — where before a failure
   * cost one Cell's rows. A refusal is not retried, so it arrives at once.
   */
  test('says nothing is awaiting a record only when the queue was actually read', async ({
    page,
  }) => {
    await mockRecordScreen(page, {});
    await page.route('**/api/v1/cells/meetings/awaiting?*', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'SCOPE_DENIED', message: 'Outside your scope.', details: {} },
        }),
      }),
    );

    await page.goto('/dashboard');

    await expect(page.locator('main').getByRole('alert').first()).not.toBeEmpty();
    await expect(page.getByText('Nothing is awaiting a record from you.')).toHaveCount(0);
    await expect(page.getByText('No Cell meeting of yours is awaiting a record.')).toHaveCount(0);
  });

  /**
   * Recording a meeting clears it from the queue.
   *
   * **This is the one thing moving the queue onto its own route broke.** It used to be
   * keyed `['cell-meetings', id, month]`, which the recording screen's own invalidation
   * cleared by prefix; `['meetings-awaiting', month]` is not under that prefix, so
   * until the screen was given the bare prefix as well, a leader who recorded a meeting
   * and went back to Record was told it was still awaiting a record. Section 19 puts
   * this queue above the figures so a leader can trust it.
   *
   * It asserts the refetch rather than the row disappearing, because the mock answers
   * every request alike: what went wrong was that no second request was made at all.
   *
   * **It returns through the navigation rather than reloading**, and that is what makes
   * it a test. Invalidating a query nobody is observing marks it stale without
   * refetching, so the second request lands when the Dashboard mounts again — and a
   * full page load would fetch on a cold cache whether or not anything was invalidated,
   * which is a green that proves nothing. Within the 30-second `staleTime`, a remount
   * refetches only because the save marked it.
   */
  test('asks the queue again after a meeting is recorded', async ({ page }) => {
    // 10:00 on 27 June in Manila, the meeting's own day.
    await page.clock.setFixedTime(new Date('2026-06-27T02:00:00Z'));
    await mockRecordScreen(page, {
      '2026-06-01': { meetings: [awaitingRow('2026-06-27', '2026-06-01')] },
    });
    await mockMeetingRoster(page);
    await page.route('**/api/v1/cells/*/meetings/*/submit', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );

    let asked = 0;
    let submitted = 0;
    page.on('request', (request) => {
      if (request.url().includes('/cells/meetings/awaiting')) {
        asked += 1;
      }
      if (request.url().includes('/submit')) {
        submitted += 1;
      }
    });

    await page.goto('/dashboard');
    await page.getByRole('link', { name: /^Record C-0007,/ }).click();

    await expect(page.getByRole('heading', { name: 'Saturday 27 June' })).toBeVisible();
    await expect.poll(() => asked).toBe(1);

    for (const member of ['Rosalinda Ocampo', 'Bienvenido Trinidad']) {
      await page.getByRole('group', { name: member }).getByRole('radio', { name: 'Present' }).check();
    }
    await page.getByRole('button', { name: /^Save/ }).click();
    // The roster mock answers `meeting: null` on every read, so a saved meeting does
    // not read back as recorded; the submission having been made is what to wait for.
    await expect.poll(() => submitted).toBe(1);

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Record' }).click();

    await expect(page.getByRole('heading', { name: 'Awaiting a record' })).toBeVisible();
    await expect.poll(() => asked).toBe(2);
  });

  // The Cells index no longer feeds the queue, and still feeds the attention list and
  // the "Cells you lead" tile — so its failure must still reach the notice rather than
  // leaving a tile reading an em dash with no reason given.
  test('reports a failed Cells read although the queue no longer depends on it', async ({
    page,
  }) => {
    await mockRecordScreen(page, {});
    await page.route('**/api/v1/cells?*', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'SCOPE_DENIED', message: 'Outside your scope.', details: {} },
        }),
      }),
    );

    await page.goto('/dashboard');

    await expect(page.locator('main').getByRole('alert').first()).not.toBeEmpty();
    await expect(page.getByText('Every Cell in your scope has recorded')).toHaveCount(0);
  });
});

test.describe('the Record queue as the owner designed it (decision 0258)', () => {
  /** 10:00 on 20 June 2026 in Manila. */
  const JUNE_20 = new Date('2026-06-20T02:00:00Z');

  async function mockQueue(page: Page) {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellMeetings(page);
    await mockCellReport(page);
    await mockDccReport(page);
    await mockDccEvents(page);
    await mockDccRoster(page);
    await mockAwaitingReassignment(page);
    await mockPeopleWithoutACell(page);

    const whoseAsked: string[] = [];
    await page.route('**/api/v1/cells/meetings/awaiting?*', (route) => {
      const url = new URL(route.request().url());
      const month = url.searchParams.get('month') ?? '2026-06-01';
      const whose = url.searchParams.get('whose') ?? 'mine';
      whoseAsked.push(whose);

      const own = awaitingRow('2026-06-13', month);
      const downline = {
        ...awaitingRow('2026-06-12', month),
        cell_id: '3f1b7c6e-0000-4000-8000-000000000104',
        cell_code: 'C-0021',
        leader: { id: '3f1b7c6e-0000-4000-8000-000000000299', full_name: 'Ana Lim', is_actor: false },
        may_record: true,
      };

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reporting_month: month,
          open: true,
          whose,
          meetings: whose === 'branch' ? [downline, own] : [own],
        }),
      });
    });

    return whoseAsked;
  }

  test('the reader’s own work is the default, and the branch view names whose each row is', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    const whoseAsked = await mockQueue(page);

    await page.goto('/dashboard');

    await expect(page.getByRole('radio', { name: 'My own Cells' })).toBeChecked();
    await expect(page.getByRole('link', { name: /^Record C-0007,/ })).toBeVisible();

    await page.getByRole('radio', { name: 'People I oversee' }).check();

    await expect.poll(() => whoseAsked).toContain('branch');
    // A downline leader's meeting the reader may record names that leader and offers Record.
    await expect(page.getByRole('link', { name: /^Record C-0021,/ })).toBeVisible();
    await expect(page.getByText(/Ana Lim · 5 members · C-0021/)).toBeVisible();
    // DCC stays the reader's own checklist; the branch view adds no Sunday rows (decision 0258).
    await expect(page.getByText(/beneath you still owe/)).toHaveCount(0);
  });

  test('rows say how long a meeting has waited, in words and without colour', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);

    await page.goto('/dashboard');

    await expect(page.getByText('Young Pro · Saturdays 7:00 pm', { exact: true })).toBeVisible();
    await expect(page.getByText('Awaiting a record · 7 days ago')).toBeVisible();
  });

  test('the filter says DCC, not Sundays', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);

    await page.goto('/dashboard');

    await expect(page.getByRole('radio', { name: 'DCC' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Sundays' })).toHaveCount(0);
  });

  test('the month’s cards sit beside the queue, each with last month’s figure', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);

    await page.goto('/dashboard');

    const cards = page.getByRole('complementary', { name: 'June so far' });
    await expect(cards.getByRole('link', { name: /Cell meetings recorded\s*6 of 8\s*May: 6 of 8/ })).toBeVisible();
    await expect(cards.getByRole('link', { name: /DCC records filed\s*12 of 18\s*May: 12 of 18/ })).toBeVisible();
  });

  test('DCC with My own Cells shows the reader’s own checklist across the month', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);

    await page.goto('/dashboard');
    await page.getByRole('radio', { name: 'DCC' }).check();

    const grid = page.getByRole('table', { name: /Your DCC checklist by Sunday/ });
    await expect(grid.getByRole('row', { name: /Rosalinda Ocampo/ })).toContainText('Present');
    await expect(grid.getByRole('row', { name: /Bienvenido Trinidad/ })).toContainText(
      'Not recorded yet',
    );

    await page.getByRole('radio', { name: 'People I oversee' }).check();
    await expect(page.getByRole('table', { name: /Your DCC checklist by Sunday/ })).toHaveCount(0);
  });
});
