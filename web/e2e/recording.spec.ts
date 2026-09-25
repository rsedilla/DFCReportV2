import { expect, test, type Page } from '@playwright/test';

import {
  PERSON_IN_SCOPE,
  mockAwaitingReassignment,
  mockCellCorrector,
  mockGrants,
  mockPeople,
  mockPeopleWithoutACell,
  mockSignedIn,
} from './mock-api';
import {
  CELL_WITH_MEETINGS,
  awaitingClosedRow,
  awaitingRow,
  closedAsked,
  mockCellMeetings,
  mockCellReport,
  mockCells,
  mockCellsAtScale,
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

  test('unlocks its marks for an account that may correct it, sending the meeting version', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellCorrector(page);
    await mockRecordedMeetingRoster(page, 'HELD');
    const sent = await captureSubmissions(page);

    await page.goto(MEETING);
    await page.getByRole('button', { name: 'Edit this record' }).click();

    await expect(page.getByLabel('Why is this changing? (optional)')).toBeVisible();
    await page.getByRole('radio', { name: 'Absent' }).first().check();
    await page.getByRole('button', { name: 'Save the correction' }).click();

    // `version`, the field the API declares: it refuses any field it does not.
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ status: 'HELD', version: 3 });
    expect(sent[0]).not.toHaveProperty('submitted_version');
  });

  // Decision 0273: whether it met may be corrected, with a reason, and the reason is
  // what Save waits for.
  test('corrects Met to Did not meet, asking why before it saves', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellCorrector(page);
    await mockRecordedMeetingRoster(page, 'HELD');
    const sent = await captureSubmissions(page);

    await page.goto(MEETING);
    await page.getByRole('button', { name: 'Edit this record' }).click();
    await page.getByRole('radio', { name: 'Did not meet' }).check();
    await page.getByRole('radio', { name: 'Leader could not be there' }).check();

    await expect(page.getByText('Say why this is being corrected to save.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save the correction' })).toBeDisabled();

    await page.getByLabel('Why is this being corrected?').fill('Filed as met by mistake');
    await page.getByRole('button', { name: 'Save the correction' }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({
      status: 'NOT_HELD',
      version: 3,
      not_held_reason: 'LEADER_UNAVAILABLE',
      correction_reason: 'Filed as met by mistake',
    });
  });

  // Owner's design, adjusted (2026-09-19): the Cell by name under the date, and the
  // record's day and counts with no name on it (decision 0201's reasoning).
  test('names the Cell and says when it was recorded and what, never by whom', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockRecordedMeetingRoster(page, 'HELD');
    await mockCellMeetings(page);

    await page.goto(MEETING);

    await expect(page.getByText('Youth · 7:00 pm · CELL-000007')).toBeVisible();
    const summary = page.getByText(/^First recorded on/);
    await expect(summary).toHaveText('First recorded on 27 Jun · 1 present, 1 absent');
  });

  test('corrects Did not meet to Met, with the whole roster and a reason', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellCorrector(page);
    await mockRecordedMeetingRoster(page, 'NOT_HELD');
    const sent = await captureSubmissions(page);

    await page.goto(MEETING);

    await expect(page.getByText('Why: Weather or calamity')).toBeVisible();
    await page.getByRole('button', { name: 'Edit this record' }).click();
    await page.getByRole('radio', { name: 'Met', exact: true }).check();

    await page.getByRole('radio', { name: 'Present' }).first().check();
    await page.getByRole('radio', { name: 'Absent' }).nth(1).check();
    await page.getByLabel('Why is this being corrected?').fill('It did meet');
    await page.getByRole('button', { name: 'Save the correction' }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({
      status: 'HELD',
      version: 3,
      attendance: [
        { person_id: '3f1b7c6e-0000-4000-8000-000000000601', present: true },
        { person_id: '3f1b7c6e-0000-4000-8000-000000000602', present: false },
      ],
      correction_reason: 'It did meet',
    });
  });

  test('offers no edit of a did-not-meet record to an account that may not correct it', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockRecordedMeetingRoster(page, 'NOT_HELD');

    await page.goto(MEETING);

    await expect(page.getByText('Why: Weather or calamity')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit this record' })).toHaveCount(0);
  });
});

// Decision 0274: who ran it defaults to the leader and may be anyone in the church.
test.describe('who ran a Cell meeting', () => {
  async function markEveryone(page: Page) {
    // `all()` does not wait, so wait for the roster first.
    await expect(page.getByRole('radio', { name: 'Present' })).toHaveCount(2);
    for (const radio of await page.getByRole('radio', { name: 'Present' }).all()) {
      await radio.check();
    }
  }

  test('sends nobody for the leader, which is the default', async ({ page }) => {
    await mockSignedIn(page);
    await mockMeetingRoster(page);
    const sent = await captureSubmissions(page);

    await page.goto(MEETING);
    await expect(page.getByRole('radio', { name: 'The leader' })).toBeChecked();
    await markEveryone(page);
    await page.getByRole('button', { name: 'Save this meeting' }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).not.toHaveProperty('facilitated_by');
  });

  test('sends the person chosen, and waits for one', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockMeetingRoster(page);
    const sent = await captureSubmissions(page);

    await page.goto(MEETING);
    await markEveryone(page);
    await page.getByRole('radio', { name: 'Someone else' }).check();

    await expect(page.getByText('Choose who ran it to save.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save this meeting' })).toBeDisabled();

    await page.getByLabel('Search for a person by name').fill('Marilou');
    await page.getByRole('button', { name: 'Find' }).click();
    await page.getByRole('button', { name: 'Choose' }).first().click();
    await page.getByRole('button', { name: 'Save this meeting' }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ status: 'HELD', facilitated_by: PERSON_IN_SCOPE.id });
  });
});

/** Every Cell meeting submission the page sends, answered as the API would. */
async function captureSubmissions(page: Page): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/v1/cells/*/meetings/*/submit', async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
  });

  return sent;
}

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

    await expect(page.getByText(/^1 of \d+ recorded$/)).toBeVisible();
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

    // Save is offered only once something differs from what is stored.
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await page
      .getByRole('group', { name: UNRECORDED.name })
      .getByRole('radio', { name: 'Present' })
      .check();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
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

  // Decision 0275: a refusal inside the records names its path, and the screen names the
  // person on that line.
  test('names the person whose line was refused', async ({ page }) => {
    await mockSignedIn(page);
    await mockDccRoster(page);
    await page.route('**/api/v1/dcc/events/*/submit', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Some fields need correcting.',
            details: {
              fields: [
                {
                  field: 'records',
                  path: 'records[1].present',
                  problems: ['present must be a boolean value'],
                },
              ],
            },
          },
        }),
      }),
    );

    await page.goto(SUNDAY);
    await page
      .getByRole('group', { name: UNRECORDED.name })
      .getByRole('radio', { name: 'Present' })
      .check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(
      page.getByText(`${UNRECORDED.name}: the mark must be a boolean value.`),
    ).toBeVisible();
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
    await chooseDcc(page);

    await expect(
      page.getByText('September · open until 7 Oct').filter({ visible: true }).first(),
    ).toBeVisible();
  });

  test('lists nothing from last month once the 7th has passed', async ({ page }) => {
    // 10:00 on 8 October in Manila.
    await page.clock.setFixedTime(new Date('2026-10-08T02:00:00Z'));
    await mockRecordScreen(page, {});

    await page.goto('/dashboard');
    await chooseDcc(page);

    // This month's rows have arrived, so an absence below is not a page still loading.
    await expect(page.getByRole('link', { name: /^Record DCC · / }).first()).toBeVisible();
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

    await expect(page.getByRole('link', { name: /^Record Young Pro · CELL-000007,/ })).toBeVisible();
    await expect(
      page.getByText('September · open until 7 Oct').filter({ visible: true }).first(),
    ).toBeVisible();
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

    // October's row has arrived, so an absence below is not a page still loading.
    await expect(page.getByRole('link', { name: /^Record Young Pro · CELL-000007,/ })).toBeVisible();
    await expect(page.getByText('open until 7 Oct')).toHaveCount(0);
  });

  /**
   * The gap this route was written to close (section 19, ruling of 2026-09-17).
   *
   * A Cell closed part-way through a month keeps meetings its leader still owes a
   * record for, and the Cells index is `ACTIVE`-only — so before this route the row
   * could not be rendered at all. The Cell's code comes from the queue rather than
   * from the index, which is why a closed Cell can be named here and nowhere else.
   *
   * The closure is said in words, in the row's What column and on the card alike, and so
   * in the Record button's accessible name, which carries the What text.
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

    const row = awaitingTable(page).getByRole('row').filter({ hasText: 'CELL-000014' });
    await expect(row.getByRole('cell')).toHaveText([
      'Saturday 3 October',
      'Youth · CELL-000014 · Cell closed Sunday 20 September',
      'You',
      'today',
      /^Record/,
    ]);
    await expect(
      page.getByRole('link', {
        name: /^Record Youth · CELL-000014 · Cell closed Sunday 20 September, Saturday 3 October$/,
      }),
    ).toHaveAttribute('href', `/cells/${CLOSED_CELL}/meetings/2026-10-03`);

    // The card below lg says the same.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: 'CELL-000014' })
        .getByText('Youth · CELL-000014 · Cell closed Sunday 20 September', { exact: true }),
    ).toBeVisible();
  });

  // Sections 13, 17 and 19 refuse to encode a record's state in colour, and a closed
  // Cell is a state. The two rows are dressed identically.
  test('marks a closed Cell no differently from an open one', async ({ page }) => {
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

    const rows = awaitingTable(page)
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: /^Record / }) });
    await expect(rows).toHaveCount(2);

    const [open, closed] = await rows.all();
    expect(await closed.getAttribute('class')).toBe(await open.getAttribute('class'));
    expect(await closed.getByRole('link').getAttribute('class')).toBe(
      await open.getByRole('link').getAttribute('class'),
    );
  });

  // The queue's columns, read off a row: when, what, whose, and how long in words.
  test('lays a meeting out as its date, what it is, whose it is and how long it has waited', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
    await mockRecordScreen(page, {
      '2026-10-01': { meetings: [awaitingRow('2026-10-03', '2026-10-01')] },
    });

    await page.goto('/dashboard');

    const table = awaitingTable(page);
    await expect(table.getByRole('columnheader')).toHaveText([
      'Date',
      'What',
      'Leader',
      'Waiting',
      'Record',
    ]);
    const row = table.getByRole('row').filter({ hasText: 'CELL-000007' });
    await expect(row.getByRole('cell')).toHaveText([
      'Saturday 3 October',
      'Young Pro · CELL-000007',
      'You',
      'today',
      /^Record/,
    ]);
  });

  // The queue is empty when the route says it is, and says so in a sentence rather
  // than by rendering nothing.
  test('says no Cell meeting is awaiting a record when the route returns none', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
    await mockRecordScreen(page, { '2026-10-01': { meetings: [] } });

    await page.goto('/dashboard');

    await expect(page.getByText('No Cell meeting of yours is awaiting a record.')).toBeVisible();
    await expect(
      awaitingHalves(page).getByRole('button', { name: /^Cell Group\s*0$/ }),
    ).toBeVisible();
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
    await expect(page.getByText('No Cell meeting of yours is awaiting a record.')).toHaveCount(0);

    // Nor does a count: a queue that was not read is not a queue of 0, and the Sundays
    // alone are not the whole of it. Each button's whole name is its label.
    await expect(recordLists(page).getByRole('button', { name: 'Awaiting a record', exact: true })).toBeVisible();
    await expect(awaitingHalves(page).getByRole('button', { name: 'Cell Group', exact: true })).toBeVisible();
    await expect(
      awaitingHalves(page).getByRole('button', { name: 'Doulos Cell Celebration', exact: true }),
    ).toBeVisible();
    // The lists whose reads succeeded still count, so the absence above is the failure's.
    await expect(recordLists(page).getByRole('button', { name: /^Not in a Cell\s*2$/ })).toBeVisible();
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
    await page.getByRole('link', { name: /^Record Young Pro · CELL-000007,/ }).click();

    await expect(page.getByRole('heading', { name: 'Saturday 27 June' })).toBeVisible();
    await expect.poll(() => asked).toBe(1);

    for (const member of ['Rosalinda Ocampo', 'Bienvenido Trinidad']) {
      await page.getByRole('group', { name: member }).getByRole('radio', { name: 'Present' }).check();
      // Kept until Save, so a tap never moves the rows beneath it (walkthrough, 2026-09-21).
      await expect(page.getByText('Not recorded yet')).toHaveCount(2);
    }
    await page.getByRole('button', { name: /^Save/ }).click();
    // The roster mock answers `meeting: null` on every read, so a saved meeting does
    // not read back as recorded; the submission having been made is what to wait for.
    await expect.poll(() => submitted).toBe(1);
    await expect(page.getByRole('link', { name: 'Back to what’s awaiting a record' })).toHaveAttribute(
      'href',
      '/dashboard',
    );

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Record' }).click();

    await expect(page.getByRole('heading', { name: 'Awaiting a record' })).toBeVisible();
    await expect.poll(() => asked).toBe(2);
  });

  // Decision 0289: the two "as of today" Cell totals left Record for the Cells page, so
  // Record carries neither tile, nor the section that held them, nor the read behind
  // "Cells you lead". Waited on the last list's count to arrive, so an absence below is
  // not a page still loading.
  test('carries no Cell totals, and never asks for the Cells the reader leads', async ({
    page,
  }) => {
    await mockRecordScreen(page, {});
    const ledByMe: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/api/v1/cells' && url.searchParams.has('led_by')) {
        ledByMe.push(request.url());
      }
    });

    await page.goto('/dashboard');
    await expect(recordLists(page).getByRole('button', { name: /^Not in a Cell\s*2$/ })).toBeVisible();
    await expect(recordLists(page).getByRole('button', { name: /^Cells behind\s*1$/ })).toBeVisible();
    await expect(page.locator('main').getByText('Loading…')).toHaveCount(0);

    await expect(page.getByRole('heading', { name: 'As things stand today' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Cells you lead/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Cells in your scope/i })).toHaveCount(0);
    expect(ledByMe).toEqual([]);
  });

  // The Cells index no longer feeds the queue, and still feeds Cells behind — so its
  // failure must still reach the notice, and Cells behind must neither count nor claim
  // that nothing is behind.
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
    // No count box: the button's whole name is its label.
    await recordLists(page).getByRole('button', { name: 'Cells behind', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Cells behind' })).toBeVisible();
    await expect(page.getByText('No Cell in your scope is behind this month.')).toHaveCount(0);
  });

  // Decision 0267: the list names a Cell a meeting that came is missing from, by the
  // server's `behind`. CELL-000001 has recorded two of the month's four and is not behind —
  // its other two have not come — so a list keyed on the whole month would name it.
  test('lists the Cells behind, and not a Cell whose unrecorded meetings have not come', async ({
    page,
  }) => {
    await mockRecordScreen(page, {});
    await mockCellsAtScale(page);

    await page.goto('/dashboard');
    await expect(recordLists(page).getByRole('button', { name: /^Cells behind\s*2$/ })).toBeVisible();
    await chooseList(page, /^Cells behind/);

    const attention = page.getByRole('region', { name: 'Cells behind' });
    await expect(attention.getByRole('link', { name: /^CELL-/ })).toHaveText([
      'CELL-000010',
      'CELL-000011',
    ]);
  });

  // Decision 0269: the requests the reader sent, each with its outcome in words.
  test('lists the requests the reader sent, with each outcome, and nothing when there are none', async ({
    page,
  }) => {
    await mockRecordScreen(page, {});
    const sent = [
      {
        id: 'r1',
        kind: 'NEW_CELL',
        state: 'PENDING',
        requested_at: '2026-06-18T02:00:00Z',
        decided_at: null,
        prospective_leader: { person_id: 'p1', full_name: 'Paolo Reyes' },
        cell: null,
        restart_of: { id: 'c14', cell_id: 'CELL-000014' },
        decline_reason: null,
        note: null,
      },
      {
        id: 'r2',
        kind: 'NEW_CELL',
        state: 'APPROVED',
        requested_at: '2026-06-02T02:00:00Z',
        decided_at: '2026-06-04T02:00:00Z',
        prospective_leader: { person_id: 'p2', full_name: 'Ramon Diaz' },
        cell: { id: 'c21', cell_id: 'CELL-000021' },
        restart_of: null,
        decline_reason: null,
        note: null,
      },
      {
        id: 'r3',
        kind: 'HANDOVER',
        state: 'DECLINED',
        requested_at: '2026-06-01T02:00:00Z',
        decided_at: '2026-06-03T02:00:00Z',
        prospective_leader: { person_id: 'p3', full_name: 'Lorna Cruz' },
        cell: { id: 'c9', cell_id: 'CELL-000009' },
        restart_of: null,
        decline_reason: 'TIMING_DEFERRED',
        note: 'Moving to another city.',
      },
    ];
    let answer: unknown[] = sent;
    await page.route('**/api/v1/cells/leadership-requests/sent*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: answer, next_cursor: null }),
      }),
    );

    await page.goto('/dashboard');

    const block = page.getByRole('region', { name: 'Your requests' });
    const rows = block.getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Restart CELL-000014 with Paolo Reyes');
    await expect(rows.nth(0)).toContainText('Waiting for approval');
    await expect(rows.nth(1)).toContainText('New Cell led by Ramon Diaz');
    await expect(rows.nth(1).getByRole('link', { name: 'CELL-000021' })).toHaveAttribute(
      'href',
      '/cells/c21/meetings',
    );
    await expect(rows.nth(2)).toContainText('Hand CELL-000009 to Lorna Cruz');
    await expect(rows.nth(2)).toContainText('The timing is deferred: Moving to another city.');

    answer = [];
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Awaiting a record' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your requests' })).toHaveCount(0);
  });

  /**
   * A list read a page at a time counts what it has read and says there is more
   * (section 19, decision 0290). With every Cell read and none behind, the count is 0 and
   * nothing points elsewhere; with a further page unread, the count is "0+" and Reports
   * is where the rest are.
   *
   * The empty row claims the whole scope only when every Cell was read, and names the
   * limit otherwise (walkthrough of 2026-09-21): "this page of your scope" was our word.
   */
  test('counts the Cells behind that it read, and says there is more when there is', async ({
    page,
  }) => {
    await mockRecordScreen(page, {});
    const notBehind = (url: string, nextCursor: string | null) =>
      JSON.stringify({
        reporting_month: '2026-06-01',
        open: true,
        data:
          new URL(url).searchParams.get('state') === 'CLOSED'
            ? []
            : [{ ...CELL_WITH_MEETINGS, coverage: { recorded: 4, scheduled: 4, behind: 0 } }],
        next_cursor: nextCursor,
      });

    await page.route('**/api/v1/cells?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: notBehind(route.request().url(), null),
      }),
    );
    await page.goto('/dashboard');
    await expect(recordLists(page).getByRole('button', { name: /^Cells behind\s*0$/ })).toBeVisible();
    await chooseList(page, /^Cells behind/);
    const attention = page.getByRole('region', { name: 'Cells behind' });
    await expect(
      attention.getByRole('cell', { name: 'No Cell in your scope is behind this month.' }),
    ).toBeVisible();
    await expect(attention.getByRole('link', { name: 'See every Cell behind in Reports' })).toHaveCount(0);
    await expect(attention.getByText(/None of the first 50/)).toHaveCount(0);

    await page.unroute('**/api/v1/cells?*');
    await page.route('**/api/v1/cells?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: notBehind(route.request().url(), 'more'),
      }),
    );
    await page.reload();
    await expect(recordLists(page).getByRole('button', { name: /^Cells behind\s*0\+$/ })).toBeVisible();
    await chooseList(page, /^Cells behind/);
    await expect(
      attention.getByRole('cell', {
        name: 'None of the first 50 Cells in your scope is behind this month.',
      }),
    ).toBeVisible();
    await expect(attention.getByText('No Cell in your scope is behind this month.')).toHaveCount(0);
    await expect(attention.getByRole('link', { name: 'See every Cell behind in Reports' })).toHaveAttribute(
      'href',
      /\/reports\/cells\?month=\d{4}-\d{2}-01&behind=1$/,
    );
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
        cell_code: 'CELL-000021',
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
    await expect(page.getByRole('link', { name: /^Record Young Pro · CELL-000007,/ })).toBeVisible();

    await page.getByRole('radio', { name: 'People I oversee' }).check();

    await expect.poll(() => whoseAsked).toContain('branch');
    // A downline leader's meeting the reader may record names that leader and offers Record.
    await expect(page.getByRole('link', { name: /^Record Young Pro · CELL-000021,/ })).toBeVisible();
    await expect(
      awaitingTable(page).getByRole('row').filter({ hasText: 'CELL-000021' }).getByRole('cell').nth(2),
    ).toHaveText('Ana Lim');
    // DCC stays the reader's own checklist; the branch view adds no Sunday rows (decision 0258).
    await expect(page.getByText(/beneath you still owe/)).toHaveCount(0);
  });

  test('rows say how long a meeting has waited, in words', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);

    await page.goto('/dashboard');

    const row = awaitingTable(page).getByRole('row').filter({ hasText: 'CELL-000007' });
    await expect(row.getByRole('cell').nth(1)).toHaveText('Young Pro · CELL-000007');
    await expect(row.getByRole('cell').nth(3)).toHaveText('7 days ago');
  });

  // Decision 0290: Awaiting a record is split into Cell Group and Doulos Cell Celebration,
  // Cell Group first, each carrying its count. The All/Cells/DCC choice is gone.
  test('splits Awaiting a record into Cell Group and Doulos Cell Celebration, Cell Group first', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);

    await page.goto('/dashboard');

    const halves = awaitingHalves(page);
    const cellGroup = halves.getByRole('button', { name: /^Cell Group/ });
    const dcc = halves.getByRole('button', { name: /^Doulos Cell Celebration/ });
    await expect(halves.getByRole('button')).toHaveCount(2);
    await expect(cellGroup).toHaveAttribute('aria-pressed', 'true');
    await expect(dcc).toHaveAttribute('aria-pressed', 'false');
    // One meeting of the reader's own, and the two Sundays with somebody still unmarked.
    await expect(halves.getByRole('button', { name: /^Cell Group\s*1$/ })).toBeVisible();
    await expect(halves.getByRole('button', { name: /^Doulos Cell Celebration\s*2$/ })).toBeVisible();
    await expect(recordLists(page).getByRole('button', { name: /^Awaiting a record\s*3$/ })).toBeVisible();

    await expect(page.getByRole('link', { name: /^Record Young Pro · CELL-000007,/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Record DCC · / })).toHaveCount(0);

    await dcc.click();
    await expect(dcc).toHaveAttribute('aria-pressed', 'true');
    await expect(cellGroup).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('link', { name: /^Record DCC · 1 of 2 marked,/ })).toHaveCount(2);
    await expect(page.getByRole('link', { name: /^Record Young Pro · / })).toHaveCount(0);

    await cellGroup.click();
    await expect(page.getByRole('link', { name: /^Record Young Pro · CELL-000007,/ })).toBeVisible();

    // The old Show choice and its words are gone.
    await expect(page.getByRole('group', { name: 'Show', exact: true })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Sundays' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'All', exact: true })).toHaveCount(0);
  });

  test('the month’s cards are a row at the foot, each with last month’s figure', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);

    await page.goto('/dashboard');

    const cards = page.getByRole('complementary', { name: 'June so far' });
    await expect(cards.getByRole('link', { name: /Cell meetings recorded\s*6 of 8\s*May: 6 of 8/ })).toBeVisible();
    await expect(cards.getByRole('link', { name: /DCC records filed\s*12 of 18\s*May: 12 of 18/ })).toBeVisible();

    // Below the work, not beside it (decision 0290).
    const queue = await page.getByRole('region', { name: 'Awaiting a record' }).boundingBox();
    const foot = await cards.boundingBox();
    expect(foot!.y).toBeGreaterThan(queue!.y + queue!.height);
  });

  test('Doulos Cell Celebration with My own Cells shows the reader’s own checklist across the month', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);

    await page.goto('/dashboard');
    await chooseDcc(page);

    const grid = page.getByRole('table', { name: /Your DCC checklist by Sunday/ });
    await expect(grid.getByRole('row', { name: /Rosalinda Ocampo/ })).toContainText('Present');
    await expect(grid.getByRole('row', { name: /Bienvenido Trinidad/ })).toContainText(
      'Not recorded yet',
    );

    await page.getByRole('radio', { name: 'People I oversee' }).check();
    await expect(page.getByRole('table', { name: /Your DCC checklist by Sunday/ })).toHaveCount(0);
  });
});

/**
 * Record opens on four lists, one at a time (SKILL.md section 19, decision 0290).
 *
 * Four equal buttons choose the list, each carrying its count; a list read a page at a
 * time counts what it has read and says there is more. Each list is a table from `lg`
 * and a card per row below it, and the two lists of people show everybody, fifty at a
 * time, with Show more.
 */
test.describe('Record’s four lists (decision 0290)', () => {
  /** 10:00 on 20 June 2026 in Manila. */
  const JUNE_20 = new Date('2026-06-20T02:00:00Z');

  async function mockRecord(page: Page) {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellMeetings(page);
    await mockMeetingsAwaiting(page);
    await mockCellReport(page);
    await mockDccReport(page);
    await mockDccEvents(page);
    await mockDccRoster(page);
    await mockAwaitingReassignment(page);
    await mockPeopleWithoutACell(page);
  }

  const person = (n: number, name: string) => ({
    id: `3f1b7c6e-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`,
    member_id: `M-0019${String(n).padStart(2, '0')}`,
    full_name: name,
  });
  const FORMER = {
    person_id: '3f1b7c6e-0000-4000-8000-000000000903',
    member_id: 'M-001003',
    full_name: 'Rogelio Mendoza',
  };

  /**
   * One of the two people lists over two pages: the first carries a cursor, the second
   * does not. Every cursor asked for is kept, so a case can say a second page was read.
   */
  async function mockTwoPages(
    page: Page,
    pattern: string,
    first: unknown[],
    second: unknown[],
  ): Promise<(string | null)[]> {
    const cursors: (string | null)[] = [];
    await page.route(pattern, (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      cursors.push(cursor);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          cursor === 'page-two'
            ? { data: second, next_cursor: null }
            : { data: first, next_cursor: 'page-two' },
        ),
      });
    });
    return cursors;
  }

  async function mockEmpty(page: Page, pattern: string) {
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], next_cursor: null }),
      }),
    );
  }

  test('opens on four equal buttons, each with its count, Awaiting a record chosen', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto('/dashboard');

    const lists = recordLists(page);
    await expect(lists.getByRole('button')).toHaveCount(4);
    // Two meetings of the reader's own and two Sundays; one Cell behind; two people on each
    // of the people lists.
    for (const name of [
      /^Awaiting a record\s*4$/,
      /^Cells behind\s*1$/,
      /^Needs a new leader\s*2$/,
      /^Not in a Cell\s*2$/,
    ]) {
      await expect(lists.getByRole('button', { name })).toBeVisible();
    }
    await expect(lists.getByRole('button', { name: /^Awaiting a record/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const name of [/^Cells behind/, /^Needs a new leader/, /^Not in a Cell/]) {
      await expect(lists.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }

    // Equal: one row of four at lg, each the same width.
    const widths = await lists
      .getByRole('button')
      .evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().width)));
    expect(new Set(widths).size).toBe(1);

    // Only the chosen list is on the page.
    await expect(page.getByRole('heading', { name: 'Awaiting a record' })).toBeVisible();
    for (const name of ['Cells behind', 'Needs a new leader', 'Not in a Cell']) {
      await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
    }
  });

  test('a list with a further page unread counts what it read and says there is more', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    await mockTwoPages(
      page,
      '**/api/v1/people/awaiting-reassignment*',
      [
        { ...person(1, 'Amihan Bacani'), former_leader: FORMER },
        { ...person(2, 'Teodoro Cruz'), former_leader: FORMER },
      ],
      [{ ...person(3, 'Zenaida Flores'), former_leader: FORMER }],
    );
    await mockTwoPages(
      page,
      '**/api/v1/cells/people-without-a-cell*',
      [person(11, 'Bituin Carreon'), person(12, 'Rodolfo Villamor')],
      [person(13, 'Soledad Aquino')],
    );
    await page.route('**/api/v1/cells?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reporting_month: '2026-06-01',
          open: false,
          data: closedAsked(route.request().url()) ? [] : [CELL_WITH_MEETINGS],
          next_cursor: closedAsked(route.request().url()) ? null : 'more-cells',
        }),
      }),
    );

    await page.goto('/dashboard');

    const lists = recordLists(page);
    await expect(lists.getByRole('button', { name: /^Cells behind\s*1\+$/ })).toBeVisible();
    await expect(lists.getByRole('button', { name: /^Needs a new leader\s*2\+$/ })).toBeVisible();
    await expect(lists.getByRole('button', { name: /^Not in a Cell\s*2\+$/ })).toBeVisible();
    // The queue is read whole, so its count carries no "+".
    await expect(lists.getByRole('button', { name: /^Awaiting a record\s*4$/ })).toBeVisible();
  });

  test('switches between the lists, showing one at a time', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto('/dashboard');

    await chooseList(page, /^Cells behind/);
    await expect(recordLists(page).getByRole('button', { name: /^Cells behind/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(recordLists(page).getByRole('button', { name: /^Awaiting a record/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByRole('heading', { name: 'Awaiting a record' })).toHaveCount(0);
    const behind = page.getByRole('table', { name: 'Cells behind' });
    await expect(behind.getByRole('columnheader')).toHaveText([
      'Cell',
      'Leader',
      'Meetings recorded',
      'Status',
    ]);
    await expect(behind.getByRole('row').filter({ hasText: 'CELL-000007' }).getByRole('cell')).toHaveText([
      'CELL-000007',
      'Teofilo Ramos',
      '3 of 4',
      'Open',
    ]);
    await expect(behind.getByRole('link', { name: 'CELL-000007' })).toHaveAttribute(
      'href',
      /^\/cells\/3f1b7c6e-0000-4000-8000-000000000101\/meetings\?month=\d{4}-\d{2}-01$/,
    );

    await chooseList(page, /^Needs a new leader/);
    await expect(page.getByRole('heading', { name: 'Cells behind' })).toHaveCount(0);
    const unplaced = page.getByRole('table', { name: 'Needs a new leader' });
    await expect(unplaced.getByRole('columnheader')).toHaveText(['Name', 'Member ID', 'Was under']);
    await expect(
      unplaced.getByRole('row').filter({ hasText: 'Amihan Bacani' }).getByRole('cell'),
    ).toHaveText(['Amihan Bacani', 'M-001001', 'Rogelio Mendoza']);
    // The action that resolves an entry is the reassignment (section 19).
    await expect(unplaced.getByRole('link', { name: 'Amihan Bacani' })).toHaveAttribute(
      'href',
      '/people/3f1b7c6e-0000-4000-8000-000000000901/network',
    );

    await chooseList(page, /^Not in a Cell/);
    await expect(page.getByRole('heading', { name: 'Needs a new leader' })).toHaveCount(0);
    const withoutACell = page.getByRole('table', { name: 'Not in a Cell' });
    await expect(withoutACell.getByRole('columnheader')).toHaveText(['Name', 'Member ID']);
    await expect(withoutACell.getByRole('link', { name: 'Bituin Carreon' })).toHaveAttribute(
      'href',
      '/people/3f1b7c6e-0000-4000-8000-000000000921',
    );
    // The retired screen is linked from nowhere on Record.
    await expect(page.locator('a[href="/people/awaiting-reassignment"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Open the full list|See everyone/ })).toHaveCount(0);

    await chooseList(page, /^Awaiting a record/);
    await expect(page.getByRole('heading', { name: 'Awaiting a record' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Not in a Cell' })).toHaveCount(0);
  });

  for (const list of [
    {
      button: /^Needs a new leader/,
      pattern: '**/api/v1/people/awaiting-reassignment*',
      first: [
        { ...person(1, 'Amihan Bacani'), former_leader: FORMER },
        { ...person(2, 'Teodoro Cruz'), former_leader: FORMER },
      ],
      second: [{ ...person(3, 'Zenaida Flores'), former_leader: FORMER }],
      table: 'Needs a new leader',
      added: 'Zenaida Flores',
    },
    {
      button: /^Not in a Cell/,
      pattern: '**/api/v1/cells/people-without-a-cell*',
      first: [person(11, 'Bituin Carreon'), person(12, 'Rodolfo Villamor')],
      second: [person(13, 'Soledad Aquino')],
      table: 'Not in a Cell',
      added: 'Soledad Aquino',
    },
  ]) {
    test(`${list.table}: Show more reads the next page in place, and stops at the last`, async ({
      page,
    }) => {
      await page.clock.setFixedTime(JUNE_20);
      await mockRecord(page);
      await page.setViewportSize({ width: 1280, height: 800 });
      const cursors = await mockTwoPages(page, list.pattern, list.first, list.second);

      await page.goto('/dashboard');
      await chooseList(page, list.button);

      const table = page.getByRole('table', { name: list.table });
      await expect(table.getByRole('link')).toHaveCount(2);
      await expect(table.getByRole('link', { name: list.added })).toHaveCount(0);

      await page.getByRole('button', { name: 'Show more' }).click();

      await expect(table.getByRole('link', { name: list.added })).toBeVisible();
      await expect(table.getByRole('link')).toHaveCount(3);
      expect(cursors).toContain('page-two');
      // The last page carries no cursor, so there is nothing more to show and the count
      // is now a figure rather than "N+".
      await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
      await expect(
        recordLists(page).getByRole('button', { name: new RegExp(`${list.button.source}\\s*3$`) }),
      ).toBeVisible();
      // Every page the list reads is fifty.
      expect(cursors.length).toBeGreaterThanOrEqual(2);
    });
  }

  test('an empty people list keeps its table and says so in one row', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    await mockEmpty(page, '**/api/v1/people/awaiting-reassignment*');
    await mockEmpty(page, '**/api/v1/cells/people-without-a-cell*');
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto('/dashboard');
    await expect(recordLists(page).getByRole('button', { name: /^Needs a new leader\s*0$/ })).toBeVisible();
    await expect(recordLists(page).getByRole('button', { name: /^Not in a Cell\s*0$/ })).toBeVisible();

    await chooseList(page, /^Needs a new leader/);
    const unplaced = page.getByRole('table', { name: 'Needs a new leader' });
    await expect(unplaced.getByRole('columnheader')).toHaveText(['Name', 'Member ID', 'Was under']);
    // The header row and the one row saying so.
    await expect(unplaced.getByRole('row')).toHaveCount(2);
    await expect(unplaced.getByRole('cell')).toHaveText(['Nobody in your scope is waiting for a new leader.']);
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);

    await chooseList(page, /^Not in a Cell/);
    const withoutACell = page.getByRole('table', { name: 'Not in a Cell' });
    await expect(withoutACell.getByRole('columnheader')).toHaveText(['Name', 'Member ID']);
    await expect(withoutACell.getByRole('row')).toHaveCount(2);
    await expect(withoutACell.getByRole('cell')).toHaveText(['Everybody in your scope is in a Cell.']);

    // Below lg the same sentence stands in for the cards.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(withoutACell).toBeHidden();
    await expect(page.getByRole('listitem').filter({ hasText: 'Everybody in your scope is in a Cell.' })).toBeVisible();
  });

  /**
   * Cards on a phone and an iPad, a table from `lg` (decision 0290). The point of the
   * cards is that Record is on screen without scrolling sideways, so that is what is
   * measured: the Record button's box inside the viewport, and the page no wider than it.
   */
  for (const viewport of [
    { name: 'a 375px phone', width: 375, height: 812 },
    { name: 'a 768px iPad', width: 768, height: 1024 },
  ]) {
    test(`on ${viewport.name} each list is cards, with Record in view and nothing sideways`, async ({
      page,
    }) => {
      await page.clock.setFixedTime(JUNE_20);
      await mockRecord(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await page.goto('/dashboard');

      const record = page.getByRole('link', { name: /^Record Young Pro · CELL-000007,/ });
      await expect(record).toBeVisible();
      await expect(awaitingTable(page)).toBeHidden();
      // The visible Record button is the card's.
      await expect(record.locator('xpath=ancestor::li')).toHaveCount(1);

      const box = await record.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

      // The other three lists are cards too.
      await chooseList(page, /^Cells behind/);
      await expect(page.getByRole('table', { name: 'Cells behind' })).toBeHidden();
      await expect(
        page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'CELL-000007' }) }),
      ).toBeVisible();

      await chooseList(page, /^Needs a new leader/);
      await expect(page.getByRole('table', { name: 'Needs a new leader' })).toBeHidden();
      await expect(
        page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Amihan Bacani' }) }),
      ).toContainText(/Was under\s*Rogelio Mendoza/);

      await chooseList(page, /^Not in a Cell/);
      await expect(page.getByRole('table', { name: 'Not in a Cell' })).toBeHidden();
      await expect(
        page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Bituin Carreon' }) }),
      ).toContainText(/Member ID\s*M-001101/);
    });
  }

  test('from lg each list is a table, and the cards are not shown', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto('/dashboard');

    const record = page.getByRole('link', { name: /^Record Young Pro · CELL-000007,/ });
    await expect(record).toBeVisible();
    await expect(awaitingTable(page)).toBeVisible();
    // The one visible Record button for that meeting is the table's.
    await expect(record.locator('xpath=ancestor::table')).toHaveCount(1);

    for (const name of ['Cells behind', 'Needs a new leader', 'Not in a Cell']) {
      await chooseList(page, new RegExp(`^${name}`));
      const table = page.getByRole('table', { name });
      await expect(table).toBeVisible();
      await expect(table.getByRole('link').first()).toBeVisible();
      await expect(page.locator('main ul.lg\\:hidden')).toBeHidden();
    }
  });
});

/** Record's four list buttons (decision 0290). */
function recordLists(page: Page) {
  return page.getByRole('group', { name: 'Outstanding work', exact: true });
}

async function chooseList(page: Page, name: RegExp) {
  await recordLists(page).getByRole('button', { name }).click();
}

/** Awaiting a record's two halves, Cell Group and Doulos Cell Celebration (decision 0290). */
function awaitingHalves(page: Page) {
  return page.getByRole('group', { name: 'Awaiting a record', exact: true });
}

async function chooseDcc(page: Page) {
  await awaitingHalves(page).getByRole('button', { name: /^Doulos Cell Celebration/ }).click();
}

/** The queue as a table, which is what is shown from `lg`. */
function awaitingTable(page: Page) {
  return page.getByRole('table', { name: 'Awaiting a record', exact: true });
}

test.describe('your month, from the queue (owner’s design, 2026-09-19)', () => {
  /** 10:00 on 20 June 2026 in Manila. */
  const JUNE_20 = new Date('2026-06-20T02:00:00Z');

  async function mockMonth(page: Page) {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellMeetings(page);
    await mockMeetingsAwaiting(page, {});
    await mockDccEvents(page);
    await mockDccRoster(page);
  }

  test('keeps the month in the address, so Back returns to the month before it', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockMonth(page);

    await page.goto('/dcc');
    await expect(page.getByText('June 2026', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Show May 2026' }).click();
    await expect(page).toHaveURL(/month=2026-05-01/);
    await expect(page.getByText('May 2026', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText('May 2026', { exact: true })).toBeVisible();

    await page.goBack();
    await expect(page.getByText('June 2026', { exact: true })).toBeVisible();
  });

  test('lists every date the reader owes, in words, each opening its record', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockMonth(page);

    await page.goto('/dcc');

    await expect(page.getByRole('heading', { name: 'Your month' })).toBeVisible();
    const grid = page.getByRole('table', { name: 'Every date you owe a record this month' });

    // A recorded Cell meeting says so and opens its record.
    await expect(
      grid.locator('a[href="/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings/2026-06-06"]'),
    ).toBeVisible();
    await expect(grid.getByText('Recorded · met').first()).toBeVisible();
    // A Sunday with somebody still unmarked, which opens that checklist.
    await expect(grid.getByText('Awaiting a record · 1 to mark').first()).toBeVisible();
    // A Sunday with no service, in its place and with its reason (section 9).
    await expect(
      grid.getByText('No service: The church held a combined regional service.'),
    ).toBeVisible();
    // A Sunday that has not happened offers no link.
    await expect(grid.getByText('Not yet').first()).toBeVisible();
    await expect(grid.getByRole('link', { name: /Sunday 28 June/ })).toHaveCount(0);
  });

  test('a closed month shows what was never recorded, with nothing to open', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockMonth(page);
    // Registered last, so it answers first: the same month, its window shut.
    await mockDccEvents(page, { open: false });

    await page.goto('/dcc');

    const grid = page.getByRole('table', { name: 'Every date you owe a record this month' });
    await expect(grid.getByText('Not recorded · month closed · 1 unmarked').first()).toBeVisible();
    await expect(grid.getByText(/Awaiting a record/)).toHaveCount(0);
    await expect(
      grid.locator('td', { hasText: 'month closed' }).locator('a[href^="/dcc/"]'),
    ).toHaveCount(0);
  });

  test('a month that has not begun shows its Sundays and says why no meeting is there', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockMonth(page);

    await page.goto('/dcc');
    await page.getByRole('button', { name: 'Show July 2026' }).click();

    await expect(page.getByText('Cell meetings appear once the month begins.')).toBeVisible();
  });

  test('the queue links to it as the whole month', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockMonth(page);
    await mockCellReport(page);
    await mockDccReport(page);
    await mockAwaitingReassignment(page);
    await mockPeopleWithoutACell(page);

    await page.goto('/dashboard');

    await expect(page.getByRole('link', { name: 'See the whole month' })).toHaveAttribute(
      'href',
      '/dcc',
    );
  });
});
