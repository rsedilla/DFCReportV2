import { expect, test, type Page } from '@playwright/test';

import {
  PERSON_IN_SCOPE,
  mockAwaitingReassignment,
  mockCellCorrector,
  mockGrants,
  mockPeople,
  mockPeopleWithoutACell,
  mockSignedIn,
  mockWholeChurchReader,
} from './mock-api';
import {
  CELL_WITH_MEETINGS,
  awaitingClosedRow,
  awaitingRow,
  mockCellMeetings,
  mockCellReport,
  mockCells,
  mockClosedDccRoster,
  mockDccEvents,
  mockDccOwed,
  mockDccReport,
  mockLeaderDccRoster,
  OWED_LEADER_ID,
  mockDccRoster,
  mockMeetingRoster,
  mockMeetingsAwaiting,
  mockRecordedMeetingRoster,
  mockPendingCg,
  mockPendingDcc,
  PENDING_CG_ROWS,
  PENDING_DCC_ROWS,
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
    await expect(page.getByRole('button', { name: 'Edit meeting' })).toHaveCount(0);

    const present = page.getByRole('radio', { name: 'Present' }).first();
    await expect(present).toBeChecked();
    await expect(present).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
  });

  // Owner's choice of 2026-10-27: each mark draws a dot, filled when chosen, and on a page
  // that cannot be changed the chosen mark keeps its full strength; only the others fade.
  test('shows each mark with a dot, and keeps the chosen one clear when read only', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockRecordedMeetingRoster(page, 'HELD');

    await page.goto(MEETING);

    const group = page.getByRole('group', { name: 'Rosalinda Ocampo' });
    const chosen = group.locator('label', { has: page.getByRole('radio', { name: 'Present' }) });
    const other = group.locator('label', { has: page.getByRole('radio', { name: 'Absent' }) });

    // A ring in each box, and the inner dot only in the chosen one.
    await expect(chosen.locator('span[aria-hidden="true"]')).toHaveCount(1);
    await expect(chosen.locator('span[aria-hidden="true"] > span')).toHaveCount(1);
    await expect(other.locator('span[aria-hidden="true"]')).toHaveCount(1);
    await expect(other.locator('span[aria-hidden="true"] > span')).toHaveCount(0);

    await expect(chosen).toHaveCSS('opacity', '1');
    await expect(other).toHaveCSS('opacity', '0.6');
  });

  test('unlocks its marks for an account that may correct it, sending the meeting version', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellCorrector(page);
    await mockRecordedMeetingRoster(page, 'HELD');
    const sent = await captureSubmissions(page);

    await page.goto(MEETING);
    await page.getByRole('button', { name: 'Edit meeting' }).click();

    await expect(page.getByLabel('Why is this changing? (optional)')).toBeVisible();
    await page.getByRole('radio', { name: 'Absent' }).first().check();
    await page.getByRole('button', { name: 'Save correction' }).click();

    // `version`, the field the API declares: it refuses any field it does not.
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ status: 'HELD', version: 3 });
    expect(sent[0]).not.toHaveProperty('submitted_version');
  });

  // A closed week refuses every save (decision 0335), so the screen offers none, as the DCC
  // checklist does for a closed Sunday.
  test('offers no edit once its week has closed, and says why', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellCorrector(page);
    await mockRecordedMeetingRoster(page, 'HELD', { weekOpen: false });

    await page.goto(MEETING);

    await expect(
      page.getByText('This week is closed, so this meeting can no longer be changed.'),
    ).toBeVisible();
    await expect(page.getByText('The marks below are what is stored.')).toBeVisible();
    await expect(page.getByText(/A correction replaces the whole roster/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit meeting' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Present' }).first()).toBeDisabled();
  });

  test('says a meeting not recorded before its week closed cannot be recorded now', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockMeetingRoster(page);
    // Registered last, so it is the one matched: an unrecorded meeting whose week closed.
    await page.route('**/api/v1/cells/*/meetings/*/roster', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cell_id: 'CELL-000007',
          meeting_id: '2026-06-27',
          scheduled_date: '2026-06-27',
          scheduled_time: '19:00',
          week_starting: '2026-06-22',
          reporting_month: '2026-06-01',
          roster_date: '2026-06-27',
          responsible_leader_id: '3f1b7c6e-0000-4000-8000-000000000299',
          may_record: true,
          week_open: false,
          meeting: null,
          members: [
            {
              person_id: '3f1b7c6e-0000-4000-8000-000000000601',
              member_id: 'M-000701',
              first_name: 'Rosalinda',
              last_name: 'Ocampo',
              full_name: 'Rosalinda Ocampo',
              record: null,
            },
          ],
        }),
      }),
    );

    await page.goto(MEETING);

    await expect(
      page.getByText(
        'This meeting was not recorded before its week closed, so it can no longer be recorded.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Met' })).toHaveCount(0);
    // Nothing to mark, so neither the roster nor the instruction to mark everyone.
    await expect(page.getByRole('heading', { name: 'Who was there' })).toHaveCount(0);
    await expect(page.getByText(/every one needs a mark/)).toHaveCount(0);
  });

  // The roster is read again when the reader comes back to the tab. If the week closed
  // meanwhile, the edit ends rather than leaving marks nobody can save under words saying
  // they are stored.
  test('ends an edit in progress when the week closes while the page is open', async ({ page }) => {
    await page.clock.install();
    await mockSignedIn(page);
    await mockCellCorrector(page);
    await mockRecordedMeetingRoster(page, 'HELD');

    await page.goto(MEETING);
    await page.getByRole('button', { name: 'Edit meeting' }).click();
    await page.getByRole('radio', { name: 'Absent' }).first().check();

    // The reader leaves the tab past the week's close and comes back: the roster is stale
    // after thirty seconds (`components/providers.tsx`) and is read again on return.
    await page.unroute('**/api/v1/cells/*/meetings/*/roster');
    await mockRecordedMeetingRoster(page, 'HELD', { weekOpen: false });
    await page.clock.fastForward(31_000);
    // TanStack Query listens for `visibilitychange` on `window`.
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));

    await expect(
      page.getByText('This week is closed, so this meeting can no longer be changed.'),
    ).toBeVisible();
    await expect(page.getByText('Editing the recorded meeting')).toHaveCount(0);
    await expect(page.getByLabel('Why is this changing? (optional)')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    // The stored marks show again, not the unsaved one.
    await expect(page.getByRole('radio', { name: 'Present' }).first()).toBeChecked();
  });

  test('ends a first record’s Did not meet when the week closes while the page is open', async ({
    page,
  }) => {
    await page.clock.install();
    await mockSignedIn(page);
    await mockMeetingRoster(page);

    await page.goto(MEETING);
    await page.getByRole('radio', { name: 'Did not meet' }).check();
    await expect(page.getByText('Why did it not meet?')).toBeVisible();

    await page.unroute('**/api/v1/cells/*/meetings/*/roster');
    await page.route('**/api/v1/cells/*/meetings/*/roster', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cell_id: 'CELL-000007',
          meeting_id: '2026-06-27',
          scheduled_date: '2026-06-27',
          scheduled_time: '19:00',
          week_starting: '2026-06-22',
          reporting_month: '2026-06-01',
          roster_date: '2026-06-27',
          responsible_leader_id: '3f1b7c6e-0000-4000-8000-000000000299',
          may_record: true,
          week_open: false,
          meeting: null,
          members: [],
        }),
      }),
    );
    await page.clock.fastForward(31_000);
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));

    await expect(
      page.getByText(
        'This meeting was not recorded before its week closed, so it can no longer be recorded.',
      ),
    ).toBeVisible();
    await expect(page.getByText('Why did it not meet?')).toHaveCount(0);
    await expect(page.getByLabel(/What happened\?/)).toHaveCount(0);
  });

  test('tells a follow-up reader an unrecorded meeting in a closed week can no longer be recorded', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockMeetingRoster(page);
    await page.route('**/api/v1/cells/*/meetings/*/roster', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cell_id: 'CELL-000007',
          meeting_id: '2026-06-27',
          scheduled_date: '2026-06-27',
          scheduled_time: '19:00',
          week_starting: '2026-06-22',
          reporting_month: '2026-06-01',
          roster_date: '2026-06-27',
          responsible_leader_id: '3f1b7c6e-0000-4000-8000-000000000299',
          may_record: false,
          week_open: false,
          meeting: null,
          members: [],
        }),
      }),
    );

    await page.goto(MEETING);

    await expect(
      page.getByText('Not recorded. Its week has closed, so it can no longer be recorded.'),
    ).toBeVisible();
    await expect(page.getByText(/you can see it here to follow up/)).toHaveCount(0);
  });

  // 2.4.11: a refusal makes the pinned bar taller, and the page's bottom scroll padding grows
  // with it, so a control focused after it never scrolls into view underneath.
  test('raises the bottom scroll padding with the bar when a refusal makes it taller', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await mockSignedIn(page);
    await mockCellCorrector(page);
    // Twelve members, so the roster is longer than the screen and focus has to scroll.
    await page.route('**/api/v1/cells/*/meetings/*/roster', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cell_id: 'CELL-000007',
          meeting_id: '2026-06-27',
          scheduled_date: '2026-06-27',
          scheduled_time: '19:00',
          week_starting: '2026-06-22',
          reporting_month: '2026-06-01',
          roster_date: '2026-06-27',
          responsible_leader_id: '3f1b7c6e-0000-4000-8000-000000000299',
          may_record: true,
          week_open: true,
          meeting: {
            id: '3f1b7c6e-0000-4000-8000-000000000301',
            status: 'HELD',
            scheduled_date: '2026-06-27',
            scheduled_time: '19:00',
            actual_date: null,
            actual_time: null,
            not_held_reason: null,
            not_held_note: null,
            facilitated_by: null,
            responsible_leader_id: '3f1b7c6e-0000-4000-8000-000000000299',
            submitted_by: '3f1b7c6e-0000-4000-8000-000000000299',
            submitted_at: '2026-06-27T13:00:00.000Z',
            version: 3,
          },
          members: Array.from({ length: 12 }, (_, i) => ({
            person_id: `3f1b7c6e-0000-4000-8000-0000000006${String(10 + i)}`,
            member_id: `M-0007${String(10 + i)}`,
            first_name: `Member${i + 1}`,
            last_name: 'Invented',
            full_name: `Member${i + 1} Invented`,
            record: { present: i % 2 === 0 },
          })),
        }),
      }),
    );
    await page.route('**/api/v1/cells/*/meetings/*/submit', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'VERSION_CONFLICT',
            message: 'This record changed after you opened it.',
            details: {},
          },
        }),
      }),
    );

    await page.goto(MEETING);
    await page.getByRole('button', { name: 'Edit meeting' }).click();
    await page.getByRole('radio', { name: 'Absent' }).first().check();
    await page.getByRole('button', { name: 'Save correction' }).click();
    await expect(page.getByText('This record changed after you opened it.')).toBeVisible();

    // With the roster scrolled under the bar, the page's bottom scroll padding (what the
    // browser keeps clear when it scrolls a focused control into view) covers everything the
    // bar and the tab bar hide. The fixed padding alone is 160px; the bar with the refusal
    // hides about 208px at this size, which is the gap that left focus under it.
    await page.getByRole('radio', { name: 'Absent' }).nth(5).scrollIntoViewIfNeeded();
    const clear = await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>('div.sticky');
      return {
        padding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
        hidden: bar ? window.innerHeight - bar.getBoundingClientRect().top : 0,
      };
    });
    expect(clear.hidden).toBeGreaterThan(160);
    expect(clear.padding).toBeGreaterThanOrEqual(clear.hidden);
  });

  // A refused save is said beside Save, in the pinned bar, not at the top of the page where
  // on a phone it sat off-screen and Save looked as if it did nothing.
  test('says a refused correction beside Save, in view on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockSignedIn(page);
    await mockCellCorrector(page);
    await mockRecordedMeetingRoster(page, 'HELD');
    await page.route('**/api/v1/cells/*/meetings/*/submit', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'PERIOD_CLOSED',
            message: 'This week is closed. Only an Admin may amend it, with a reason.',
            details: {},
          },
        }),
      }),
    );

    await page.goto(MEETING);
    await page.getByRole('button', { name: 'Edit meeting' }).click();
    await page.getByRole('radio', { name: 'Absent' }).first().check();
    const save = page.getByRole('button', { name: 'Save correction' });
    await save.click();

    const refusal = page.getByText('This week is closed. Only an Admin may amend it, with a reason.');
    await expect(refusal).toHaveCount(1);
    await expect(refusal).toBeInViewport();
    await expect(save).toBeInViewport();
  });

  // Decision 0273: whether it met may be corrected, with a reason, and the reason is
  // what Save waits for.
  test('corrects Met to Did not meet, asking why before it saves', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellCorrector(page);
    await mockRecordedMeetingRoster(page, 'HELD');
    const sent = await captureSubmissions(page);

    await page.goto(MEETING);
    await page.getByRole('button', { name: 'Edit meeting' }).click();
    await page.getByRole('radio', { name: 'Did not meet' }).check();
    await page.getByRole('radio', { name: 'Leader could not be there' }).check();

    await expect(page.getByText('Say why this is being corrected to save.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save correction' })).toBeDisabled();

    await page.getByLabel('Why is this being corrected?').fill('Filed as met by mistake');
    await page.getByRole('button', { name: 'Save correction' }).click();

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
    await page.getByRole('button', { name: 'Edit meeting' }).click();
    await page.getByRole('radio', { name: 'Met', exact: true }).check();

    await page.getByRole('radio', { name: 'Present' }).first().check();
    await page.getByRole('radio', { name: 'Absent' }).nth(1).check();
    await page.getByLabel('Why is this being corrected?').fill('It did meet');
    await page.getByRole('button', { name: 'Save correction' }).click();

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
    await expect(page.getByRole('button', { name: 'Edit meeting' })).toHaveCount(0);
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

  test('shows another leader’s meeting read only, with nothing to save (decision 0322)', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockMeetingRoster(page);
    // Registered last, so it is the one matched: this reader may not record it.
    await page.route('**/api/v1/cells/*/meetings/*/roster', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cell_id: 'CELL-000007',
          meeting_id: '2026-06-27',
          scheduled_date: '2026-06-27',
          scheduled_time: '19:00',
          week_starting: '2026-06-22',
          reporting_month: '2026-06-01',
          roster_date: '2026-06-27',
          responsible_leader_id: '3f1b7c6e-0000-4000-8000-000000000299',
          may_record: false,
          meeting: null,
          members: [
            {
              person_id: '3f1b7c6e-0000-4000-8000-000000000601',
              member_id: 'M-000701',
              first_name: 'Rosalinda',
              last_name: 'Ocampo',
              full_name: 'Rosalinda Ocampo',
              record: null,
            },
          ],
        }),
      }),
    );

    await page.goto(MEETING);

    await expect(page.getByText(/The Cell’s leader records it; you can see it here to follow up\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save meeting' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Met' })).toHaveCount(0);
    for (const radio of await page.getByRole('radio', { name: 'Present' }).all()) {
      await expect(radio).toBeDisabled();
    }
  });

  test('sends nobody for the leader, which is the default', async ({ page }) => {
    await mockSignedIn(page);
    await mockMeetingRoster(page);
    const sent = await captureSubmissions(page);

    await page.goto(MEETING);
    await expect(page.getByRole('radio', { name: 'The leader' })).toBeChecked();
    await markEveryone(page);
    await page.getByRole('button', { name: 'Save meeting' }).click();

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
    await expect(page.getByRole('button', { name: 'Save meeting' })).toBeDisabled();

    await page.getByLabel('Search for a person by name').fill('Marilou');
    await page.getByRole('button', { name: 'Search people' }).click();
    await page.getByRole('button', { name: 'Choose' }).first().click();
    await page.getByRole('button', { name: 'Save meeting' }).click();

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

// As on the Cell meeting screen: once the Sunday takes no record, an edit in progress ends
// and the stored marks show again, rather than marks nobody can save or discard.
test('ends a DCC edit in progress when the Sunday stops taking records', async ({ page }) => {
  await page.clock.install();
  await mockSignedIn(page);
  await mockGrants(page, ['dcc.correct_subtree']);
  await mockDccRoster(page);

  await page.goto('/dcc/3f1b7c6e-0000-4000-8000-000000000501');
  await page.getByRole('button', { name: 'Edit marks' }).click();
  await page
    .getByRole('group', { name: 'Rosalinda Ocampo' })
    .getByRole('radio', { name: 'Absent' })
    .check();
  await expect(page.getByRole('button', { name: 'Save marks', exact: true })).toBeVisible();

  await page.unroute('**/api/v1/dcc/events/*/roster*');
  await mockClosedDccRoster(page);
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));

  await expect(page.getByText('This Sunday takes no record')).toBeVisible();
  const present = page.getByRole('group', { name: 'Rosalinda Ocampo' }).getByRole('radio', {
    name: 'Present',
  });
  await expect(present).toBeChecked();
  await expect(present).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
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
    await expect(page.getByRole('button', { name: 'Edit marks' })).toHaveCount(0);

    const recorded = page.getByRole('group', { name: RECORDED.name }).getByRole('radio', {
      name: 'Present',
    });
    await expect(recorded).toBeChecked();
    await expect(recorded).toBeDisabled();
    await expect(
      page.getByRole('group', { name: UNRECORDED.name }).getByRole('radio', { name: 'Present' }),
    ).toBeEnabled();

    // Save is offered only once something differs from what is stored.
    await expect(page.getByRole('button', { name: 'Save marks', exact: true })).toHaveCount(0);
    await page
      .getByRole('group', { name: UNRECORDED.name })
      .getByRole('radio', { name: 'Present' })
      .check();
    await expect(page.getByRole('button', { name: 'Save marks', exact: true })).toBeVisible();
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
    await page.getByRole('button', { name: 'Edit marks' }).click();

    await page
      .getByRole('group', { name: RECORDED.name })
      .getByRole('radio', { name: 'Absent' })
      .check();
    await page
      .getByRole('group', { name: UNRECORDED.name })
      .getByRole('radio', { name: 'Present' })
      .check();
    await page.getByLabel('Why is this changing? (optional)').fill('Marked the wrong person');
    await page.getByRole('button', { name: 'Save marks', exact: true }).click();

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

  // As on the Cell meeting screen: a refused save is said in the pinned bar, beside Save.
  test('says a refused save beside Save, in view on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockSignedIn(page);
    await mockDccRoster(page);
    await page.route('**/api/v1/dcc/events/*/submit', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'PERIOD_CLOSED',
            message: 'This week is closed. Only an Admin may amend it, with a reason.',
            details: {},
          },
        }),
      }),
    );

    await page.goto(SUNDAY);
    await page
      .getByRole('group', { name: UNRECORDED.name })
      .getByRole('radio', { name: 'Present' })
      .check();
    const save = page.getByRole('button', { name: 'Save marks', exact: true });
    await save.click();

    const refusal = page.getByText('This week is closed. Only an Admin may amend it, with a reason.');
    await expect(refusal).toHaveCount(1);
    await expect(refusal).toBeInViewport();
    await expect(save).toBeInViewport();
  });

  // Decision 0338: the Sunday says what is left in Not recorded's words, and once saved its
  // link back opens Update Records on DCC, the half just recorded.
  test('says what is left to mark, and links back to Update Records on DCC once saved', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockDccRoster(page);
    await page.route('**/api/v1/dcc/events/*/submit', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );

    await page.goto(SUNDAY);
    await expect(page.getByText(/Not recorded · 1 to mark\./)).toBeVisible();

    await page
      .getByRole('group', { name: UNRECORDED.name })
      .getByRole('radio', { name: 'Present' })
      .check();
    await page.getByRole('button', { name: 'Save marks', exact: true }).click();

    // The line after Saved, beside the page's own link back, which goes to the same place.
    await expect(page.getByText('Saved.').getByRole('link', { name: 'Back to Update Records' })).toHaveAttribute(
      'href',
      '/dashboard?list=awaiting&kind=dcc',
    );
    for (const link of await page.getByRole('link', { name: 'Back to Update Records' }).all()) {
      await expect(link).toHaveAttribute('href', '/dashboard?list=awaiting&kind=dcc');
    }
  });

  // The page's own link back goes to Record's DCC list; the month page is not linked for now
  // (owner, 2026-10-23).
  test('links back to Update Records on DCC, not to the month', async ({ page }) => {
    await mockSignedIn(page);
    await mockDccRoster(page);
    await page.goto(SUNDAY);

    await expect(page.getByRole('link', { name: 'Back to Update Records' })).toHaveAttribute(
      'href',
      '/dashboard?list=awaiting&kind=dcc',
    );
    await expect(page.getByRole('link', { name: 'Back to your month' })).toHaveCount(0);
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
    await page.getByRole('button', { name: 'Save marks', exact: true }).click();

    await expect(
      page.getByText(`${UNRECORDED.name}: the mark must be a boolean value.`),
    ).toBeVisible();
  });
});

// Decision 0312: the Sunday checklist opens with Your 12, then one section per leader without
// an account whose people fall to the reader, then the Network roots. Invented names.
test.describe('a DCC checklist in sections', () => {
  const SUNDAY = '/dcc/3f1b7c6e-0000-4000-8000-000000000501';
  const READER = '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9';
  const NESTOR = '3f1b7c6e-0000-4000-8000-000000000711';
  const ABSENT_LEADER = '3f1b7c6e-0000-4000-8000-000000000799';

  const line = (n: number, name: string, leader: string | null) => ({
    person_id: `3f1b7c6e-0000-4000-8000-${String(700 + n).padStart(12, '0')}`,
    member_id: `M-0007${String(n).padStart(2, '0')}`,
    full_name: name,
    first_name: name.split(' ')[0],
    last_name: name.split(' ').slice(1).join(' '),
    responsible_leader_id: leader,
    record: null,
  });

  async function mockSections(page: Page, extra: ReturnType<typeof line>[] = []) {
    await mockSignedIn(page);
    await page.route('**/api/v1/dcc/events/*/roster*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          event: {
            id: '3f1b7c6e-0000-4000-8000-000000000501',
            event_date: '2026-06-07',
            recordable: true,
            not_recordable_reason: null,
            removed: false,
            removal_reason: null,
            coverage: null,
          },
          // In the roster's own order: first name, surname, Member ID (decision 0359).
          data: [
            line(1, 'Corazon Dela Cruz', READER),
            line(2, 'Eduardo Galang', null),
            { ...line(3, 'Nestor Ilagan', READER), person_id: NESTOR },
            line(4, 'Pia Ilagan', NESTOR),
            line(5, 'Ramon Villa', READER),
            ...extra,
          ],
          next_cursor: null,
        }),
      }),
    );
  }

  const headings = (page: Page) =>
    page.getByRole('main').getByRole('heading', { level: 2 }).allTextContents();

  test('opens with Your 12, then a leader without an account, then the Network roots', async ({
    page,
  }) => {
    await mockSections(page);
    await page.goto(SUNDAY);

    await expect(page.getByRole('heading', { name: /^Your 12/ })).toBeVisible();
    expect(await headings(page)).toEqual([
      'Your 12 · 0 of 3 marked',
      'Nestor Ilagan’s people',
      'Network roots',
    ]);
    await expect(page.getByText('Nestor Ilagan has no account yet, so you record them.')).toBeVisible();
    await expect(page.getByText(/^0 of 5 marked$/)).toBeVisible();

    const yours = page.getByRole('region', { name: /^Your 12/ });
    await expect(yours.getByRole('group')).toHaveCount(3);
    await expect(page.getByRole('region', { name: 'Nestor Ilagan’s people' }).getByRole('group', { name: 'Pia Ilagan' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Network roots' }).getByRole('group', { name: 'Eduardo Galang' })).toBeVisible();
  });

  test('counts only Your 12 beside a heading, and one Save sends every section', async ({ page }) => {
    await mockSections(page);
    const sent: { records: { person_id: string }[] }[] = [];
    await page.route('**/api/v1/dcc/events/*/submit', async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto(SUNDAY);

    await page.getByRole('group', { name: 'Ramon Villa' }).getByRole('radio', { name: 'Present' }).check();
    await page.getByRole('group', { name: 'Pia Ilagan' }).getByRole('radio', { name: 'Present' }).check();
    await page.getByRole('group', { name: 'Eduardo Galang' }).getByRole('radio', { name: 'Absent' }).check();

    await expect(page.getByRole('heading', { name: 'Your 12 · 1 of 3 marked' })).toBeVisible();
    // No figure beside another leader's name (section 13, decision 0293).
    await expect(page.getByRole('heading', { name: 'Nestor Ilagan’s people', exact: true })).toBeVisible();
    await expect(page.getByText(/^3 of 5 marked$/)).toBeVisible();

    await page.getByRole('button', { name: 'Save marks', exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].records.map((record) => record.person_id).sort()).toEqual(
      [line(2, '', null), line(4, '', null), line(5, '', null)].map((entry) => entry.person_id).sort(),
    );
  });

  test('names a section "A leader without an account" when that leader’s line is not on the page', async ({
    page,
  }) => {
    await mockSections(page, [line(6, 'Tomas Yap', ABSENT_LEADER)]);
    await page.goto(SUNDAY);

    await expect(page.getByRole('heading', { name: 'A leader without an account' })).toBeVisible();
    expect((await headings(page)).at(-2)).toBe('A leader without an account');
  });

  test('leaves out an empty Your 12', async ({ page }) => {
    await mockSignedIn(page);
    await page.route('**/api/v1/dcc/events/*/roster*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          event: {
            id: '3f1b7c6e-0000-4000-8000-000000000501',
            event_date: '2026-06-07',
            recordable: true,
            not_recordable_reason: null,
            removed: false,
            removal_reason: null,
            coverage: null,
          },
          data: [line(2, 'Eduardo Galang', null), line(7, 'Lourdes Navarro', null)],
          next_cursor: null,
        }),
      }),
    );
    await page.goto(SUNDAY);

    await expect(page.getByRole('heading', { name: 'Network roots' })).toBeVisible();
    expect(await headings(page)).toEqual(['Network roots']);
  });
});

// Checklist row decision-dcc-record-over-50: the screen asks for 200, the API's most, so a
// checklist of up to 200 shows and saves whole, and only a longer one says it is cut short.
test.describe('a long DCC checklist', () => {
  const SUNDAY = '/dcc/3f1b7c6e-0000-4000-8000-000000000501';
  const LONG = 'More than 200 people are on this checklist.';

  // Invented people, all recorded but the last.
  const line = (n: number, size: number) => ({
    person_id: `3f1b7c6e-0000-4000-8000-${String(700000 + n).padStart(12, '0')}`,
    member_id: `M-${String(900000 + n)}`,
    full_name: `Person ${String(n).padStart(3, '0')}`,
    first_name: `Person ${String(n).padStart(3, '0')}`,
    last_name: 'Test',
    responsible_leader_id: '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9',
    record: n === size ? null : { present: true, version: 1, recorded_at: '2026-06-07T12:00:00.000Z' },
  });

  // Pages as the API does: 50 unless asked, at most 200, with a cursor when more remain.
  async function mockLongRoster(page: Page, size: number) {
    const asked: string[] = [];
    await page.route('**/api/v1/dcc/events/*/roster*', (route) => {
      asked.push(route.request().url());
      const limit = Math.min(Number(new URL(route.request().url()).searchParams.get('limit') ?? 50), 200);
      const shown = Math.min(size, limit);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          event: {
            id: '3f1b7c6e-0000-4000-8000-000000000501',
            event_date: '2026-06-07',
            recordable: true,
            not_recordable_reason: null,
            removed: false,
            removal_reason: null,
            coverage: null,
          },
          data: Array.from({ length: shown }, (_, index) => line(index + 1, size)),
          next_cursor: shown < size ? 'page-two' : null,
        }),
      });
    });
    return asked;
  }

  test('asks for 200 people at once', async ({ page }) => {
    await mockSignedIn(page);
    const asked = await mockLongRoster(page, 2);

    await page.goto(SUNDAY);

    await expect(page.getByRole('group', { name: 'Person 002' })).toBeVisible();
    expect(asked.length).toBeGreaterThan(0);
    for (const url of asked) {
      expect(new URL(url).searchParams.get('limit')).toBe('200');
    }
  });

  test('shows a checklist of 73 whole, and saves the 73rd person with the rest', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockLongRoster(page, 73);
    const sent: { records: { person_id: string; present: boolean }[] }[] = [];
    await page.route('**/api/v1/dcc/events/*/submit', async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto(SUNDAY);

    await expect(page.getByText(/^72 of 73 recorded$/)).toBeVisible();
    await expect(page.getByText(LONG)).toHaveCount(0);

    await page
      .getByRole('group', { name: 'Person 073' })
      .getByRole('radio', { name: 'Present' })
      .check();
    await page.getByRole('button', { name: 'Save marks', exact: true }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].records).toHaveLength(73);
    expect(sent[0].records.at(-1)).toMatchObject({ person_id: line(73, 73).person_id, present: true });
  });

  test('says so when more than 200 are on it', async ({ page }) => {
    await mockSignedIn(page);
    await mockLongRoster(page, 201);

    await page.goto(SUNDAY);

    await expect(page.getByRole('group', { name: 'Person 200' })).toBeVisible();
    await expect(
      page.getByText(
        'More than 200 people are on this checklist. Recording the rest is not yet possible from this screen.',
      ),
    ).toBeVisible();
  });

  for (const width of [320, 690, 1280]) {
    test(`scrolls nothing sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockSignedIn(page);
      await mockLongRoster(page, 201);

      await page.goto(SUNDAY);
      await expect(page.getByText(LONG)).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
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
    await mockPendingDcc(page);
    // One Cell still to record (decision 0368).
    await mockPendingCg(page, [PENDING_CG_ROWS[0]]);
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

    // Every row says when it closes (decision 0335); the DCC mock's Sundays are June's.
    await expect(
      page.getByText('Closes end of Tue 7 Jul').filter({ visible: true }).first(),
    ).toBeVisible();
  });

  test('lists nothing from last month once the 7th has passed', async ({ page }) => {
    // 10:00 on 8 October in Manila.
    await page.clock.setFixedTime(new Date('2026-10-08T02:00:00Z'));
    await mockRecordScreen(page, {});
    const asked: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/dcc/events?')) {
        asked.push(request.url());
      }
    });

    await page.goto('/dashboard');
    await chooseDcc(page);

    // This month's rows have arrived, so an absence below is not a page still loading.
    await expect(page.getByRole('link', { name: /^Record DCC · / }).first()).toBeVisible();
    expect(asked.some((url) => url.includes('month=2026-09-01'))).toBe(false);
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

    await expect(page.getByRole('link', { name: /^Record Young Pro · Sat,/ })).toBeVisible();
    await expect(
      page.getByText('Closes end of Wed 7 Oct').filter({ visible: true }).first(),
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
    await expect(page.getByRole('link', { name: /^Record Young Pro · Sat,/ })).toBeVisible();
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

    const row = awaitingTable(page).getByRole('row').filter({ hasText: 'Youth · Sat · Cell closed' });
    await expect(row.getByRole('cell')).toHaveText([
      'Saturday 3 October',
      'Youth · Sat · Cell closed Sunday 20 September',
      'You',
      // The row's close beside how long it has waited (decision 0335).
      'todayCloses end of Sat 7 Nov',
      /^Record/,
    ]);
    await expect(
      page.getByRole('link', {
        name: /^Record Youth · Sat · Cell closed Sunday 20 September, Saturday 3 October$/,
      }),
    ).toHaveAttribute('href', `/cells/${CLOSED_CELL}/meetings/2026-10-03`);

    // The card below lg says the same.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: 'Youth · Sat · Cell closed' })
        .getByText('Youth · Sat · Cell closed Sunday 20 September', { exact: true }),
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
    const row = table.getByRole('row').filter({ hasText: 'Young Pro · Sat' });
    await expect(row.getByRole('cell')).toHaveText([
      'Saturday 3 October',
      'Young Pro · Sat',
      'You',
      // The row's close beside how long it has waited (decision 0335).
      'todayCloses end of Sat 7 Nov',
      /^Record/,
    ]);
  });

  // The queue is empty when the route says it is, and says so in a sentence rather
  // than by rendering nothing.
  test('says there is nothing to record when the route returns none', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
    await mockRecordScreen(page, { '2026-10-01': { meetings: [] } });

    await page.goto('/dashboard');

    await expect(page.getByText('Nothing to record. You’re up to date.')).toBeVisible();
    // Each tab says what it is for (owner, 2026-10-26).
    await expect(
      page.getByText(
        'Your own meetings and Sundays still to record. Each week is due by 12 noon on the second Monday after it.',
      ),
    ).toBeVisible();
    // A 0 shows no box (decision 0350).
    await expect(
      awaitingHalves(page).getByRole('button', { name: /^Cell Group$/ }),
    ).toBeVisible();
  });

  /**
   * A read that failed must never render as "nothing to do" (section 19).
   *
   * This is the assertion that matters most after the ruling: the queue's Cell half is
   * now **one** request, so one refusal empties it completely — where before a failure
   * cost one Cell's rows. A refusal is not retried, so it arrives at once.
   */
  test('says there is nothing to record only when the queue was actually read', async ({
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
    await expect(page.getByText('Nothing to record.')).toHaveCount(0);

    // Nor does a count: a queue that was not read is not a queue of 0, and the Sundays
    // alone are not the whole of it. Each button's whole name is its label.
    await expect(recordLists(page).getByRole('button', { name: 'Update Records', exact: true })).toBeVisible();
    await expect(awaitingHalves(page).getByRole('button', { name: 'Cell Group', exact: true })).toBeVisible();
    await expect(
      awaitingHalves(page).getByRole('button', { name: 'DCC', exact: true }),
    ).toBeVisible();
    // The lists whose reads succeeded still count, so the absence above is the failure's.
    await expect(recordLists(page).getByRole('button', { name: /^Pending CG Records\s*1$/ })).toBeVisible();
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
    await page.getByRole('link', { name: /^Record Young Pro · Sat,/ }).click();

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
    await expect(page.getByRole('link', { name: 'Back to Update Records' })).toHaveAttribute(
      'href',
      '/dashboard?list=awaiting',
    );

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Record' }).click();

    await expect(page.getByRole('region', { name: 'Update Records' })).toBeVisible();
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
    await expect(recordLists(page).getByRole('button', { name: /^Pending CG Records\s*1$/ })).toBeVisible();
    await expect(page.locator('main').getByText('Loading…')).toHaveCount(0);

    await expect(page.getByRole('heading', { name: 'As things stand today' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Cells you lead/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Cells you oversee/i })).toHaveCount(0);
    expect(ledByMe).toEqual([]);
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
        restart_of: { id: 'c14', cell_id: 'CELL-000014', category: 'YOUTH', day_of_week: 6 },
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
        cell: { id: 'c21', cell_id: 'CELL-000021', category: 'COUPLE', day_of_week: 3 },
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
        cell: { id: 'c9', cell_id: 'CELL-000009', category: 'YOUNG_PRO', day_of_week: 5 },
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
    // Each Cell is named by what the sender's own request recorded of it (decisions 0306
    // and 0346), never by its code while one is recorded.
    await expect(block).not.toContainText('CELL-');
    await expect(rows.nth(0)).toContainText('Restart Youth · Sat with Paolo Reyes');
    await expect(rows.nth(0)).toContainText('Waiting for approval');
    await expect(rows.nth(1)).toContainText('New Cell led by Ramon Diaz');
    await expect(rows.nth(1).getByRole('link', { name: 'Couple · Wed' })).toHaveAttribute(
      'href',
      '/cells/c21/meetings',
    );
    await expect(rows.nth(2)).toContainText('Hand Young Pro · Fri to Lorna Cruz');
    await expect(rows.nth(2)).toContainText('The timing is deferred: Moving to another city.');

    // A request sent before its Cell's name was recorded is named by its code.
    answer = [{ ...sent[2], cell: { id: 'c9', cell_id: 'CELL-000009', category: null, day_of_week: null } }];
    await page.reload();
    await expect(block.getByRole('listitem')).toHaveCount(1);
    await expect(block).toContainText('Hand CELL-000009 to Lorna Cruz');

    answer = [];
    await page.reload();
    await expect(page.getByRole('region', { name: 'Update Records' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your requests' })).toHaveCount(0);
  });

});

test.describe('Update Records for a Full view leader (decision 0382)', () => {
  /** 10:00 on 20 June 2026 in Manila. */
  const JUNE_20 = new Date('2026-06-20T02:00:00Z');

  test('has no Whose switch, and shows the reader’s own work even when the address asks for the branch', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellMeetings(page);
    await mockMeetingsAwaiting(page);
    await mockCellReport(page);
    await mockDccReport(page);
    await mockDccEvents(page);
    await mockDccRoster(page);
    await mockPendingDcc(page);
    const asked: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/cells/meetings/awaiting')) {
        asked.push(new URL(request.url()).searchParams.get('whose') ?? 'mine');
      }
    });

    await page.goto('/dashboard?whose=branch');

    await expect(page.getByRole('region', { name: 'Update Records' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Record Young Pro · Sat,/ }).first()).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Leaders Under Me' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Whose' })).toHaveCount(0);
    expect(asked).not.toContain('branch');
    // Their branch's work is on the two Pending lists, still offered.
    for (const name of [/^Pending CG Records/, /^Pending DCC Records/]) {
      await expect(recordLists(page).getByRole('button', { name })).toBeVisible();
    }
  });
});

test.describe('the Record queue as the owner designed it (decision 0258)', () => {
  /** 10:00 on 20 June 2026 in Manila. */
  const JUNE_20 = new Date('2026-06-20T02:00:00Z');

  async function mockQueue(page: Page) {
    await mockSignedIn(page);
    // The Admin's reach, who keeps Leaders Under Me (decision 0382).
    await mockWholeChurchReader(page);
    await mockCells(page);
    await mockCellMeetings(page);
    await mockCellReport(page);
    await mockDccReport(page);
    await mockDccEvents(page);
    await mockDccRoster(page);
    await mockAwaitingReassignment(page);
    await mockPeopleWithoutACell(page);
    await mockPendingDcc(page);

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
        leader: {
          id: '3f1b7c6e-0000-4000-8000-000000000299',
          full_name: 'Ana Lim',
          last_name: 'Lim',
          first_name: 'Ana',
          member_id: 'M-000415',
          is_actor: false,
        },
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

    await expect(page.getByRole('radio', { name: 'Own ' })).toBeChecked();
    await expect(page.getByRole('link', { name: /^Record Young Pro · Sat,/ })).toBeVisible();

    await page.getByRole('radio', { name: 'Leaders Under Me' }).check();

    await expect.poll(() => whoseAsked).toContain('branch');
    // A downline leader's meeting the reader may record is under that leader's line, and
    // offers Record once the line is opened (decision 0311).
    await page.getByRole('button', { name: 'Ana Lim' }).click();
    await expect(page.getByRole('link', { name: /^Record Young Pro · Fri,/ })).toBeVisible();
    await expect(
      page
        .getByRole('table', { name: 'Update Records, Ana Lim' })
        .getByRole('row')
        .filter({ hasText: 'Young Pro · Fri' })
        .getByRole('cell')
        .nth(2),
    ).toHaveText('Ana Lim');
  });

  // Decision 0322: another leader's meeting is followed up, not recorded.
  test('a downline leader’s meeting the reader may not record offers See meeting, not Record', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);
    // Registered last, so it is the one matched: the API says the reader may not record Ana's.
    await page.route('**/api/v1/cells/meetings/awaiting?*', (route) => {
      const month = new URL(route.request().url()).searchParams.get('month') ?? '2026-06-01';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reporting_month: month,
          open: true,
          whose: 'branch',
          meetings: [
            {
              ...awaitingRow('2026-06-12', month),
              cell_id: '3f1b7c6e-0000-4000-8000-000000000104',
              cell_code: 'CELL-000021',
              leader: {
                id: '3f1b7c6e-0000-4000-8000-000000000299',
                full_name: 'Ana Lim',
                last_name: 'Lim',
                first_name: 'Ana',
                member_id: 'M-000415',
                is_actor: false,
              },
              may_record: false,
            },
          ],
        }),
      });
    });

    await page.goto('/dashboard?whose=branch');
    await page.getByRole('button', { name: 'Ana Lim' }).click();

    await expect(page.getByRole('link', { name: /^See meeting Young Pro · Fri,/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Record Young Pro · Fri,/ })).toHaveCount(0);
  });

  // Decision 0311: one line per leader, name only, in first-name order (decision 0359),
  // closed until opened.
  test('Leaders Under Me is one line per leader, by first name, each opened to its meetings', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);

    await page.goto('/dashboard?whose=branch');

    const lines = page.getByRole('region', { name: 'Update Records' }).getByRole('button', {
      name: /^(Ana Lim|Teofilo Ramos \(you\))$/,
    });
    // Ana before Teofilo: first-name order, whoever the reader is.
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toHaveAccessibleName('Ana Lim');
    await expect(lines.nth(1)).toHaveAccessibleName('Teofilo Ramos (you)');
    // Name only: no count and no date on the line, and nothing shown until it is opened.
    await expect(page.getByRole('link', { name: /^Record Young Pro/ })).toHaveCount(0);

    const ana = page.getByRole('button', { name: 'Ana Lim' });
    await expect(ana).toHaveAttribute('aria-expanded', 'false');
    await ana.click();
    await expect(ana).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('link', { name: /^Record Young Pro · Fri,/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Record Young Pro · Sat,/ })).toHaveCount(0);

    await ana.click();
    await expect(page.getByRole('link', { name: /^Record Young Pro/ })).toHaveCount(0);
  });

  // Decision 0311: last month's close is stated once above the list, and each row keeps
  // its own month label.
  test('the branch view states last month’s close once, in the first week', async ({ page }) => {
    // 10:00 on 3 July in Manila: June is open until the 7th.
    await page.clock.setFixedTime(new Date('2026-07-03T02:00:00Z'));
    await mockQueue(page);

    await page.goto('/dashboard?whose=branch');

    await expect(page.getByText('June is open until the end of Tuesday 7 July.')).toBeVisible();
    await page.getByRole('button', { name: 'Ana Lim' }).click();
    await expect(
      page.getByRole('table', { name: 'Update Records, Ana Lim' }).getByText('Closes end of Tue 7 Jul').first(),
    ).toBeVisible();

    await page.getByRole('radio', { name: 'Own ' }).check();
    await expect(page.getByText('June is open until the end of Tuesday 7 July.')).toHaveCount(0);
  });

  test('rows say how long a meeting has waited, in words', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);

    await page.goto('/dashboard');

    const row = awaitingTable(page).getByRole('row').filter({ hasText: 'Young Pro · Sat' });
    await expect(row.getByRole('cell').nth(1)).toHaveText('Young Pro · Sat');
    await expect(row.getByRole('cell').nth(3)).toHaveText('7 days agoCloses end of Tue 7 Jul');
  });

  // Decision 0290: Awaiting a record is split into Cell Group and DCC,
  // Cell Group first, each carrying its count. The All/Cells/DCC choice is gone.
  test('splits Awaiting a record into Cell Group and DCC, Cell Group first', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);

    await page.goto('/dashboard');

    const halves = awaitingHalves(page);
    const cellGroup = halves.getByRole('button', { name: /^Cell Group/ });
    const dcc = halves.getByRole('button', { name: /^DCC/ });
    await expect(halves.getByRole('button')).toHaveCount(2);
    await expect(cellGroup).toHaveAttribute('aria-pressed', 'true');
    await expect(dcc).toHaveAttribute('aria-pressed', 'false');
    // One meeting of the reader's own, and the two Sundays with somebody still unmarked.
    await expect(halves.getByRole('button', { name: /^Cell Group\s*1$/ })).toBeVisible();
    await expect(halves.getByRole('button', { name: /^DCC\s*2$/ })).toBeVisible();
    await expect(recordLists(page).getByRole('button', { name: /^Update Records\s*3$/ })).toBeVisible();

    await expect(page.getByRole('link', { name: /^Record Young Pro · Sat,/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Record DCC · / })).toHaveCount(0);

    await dcc.click();
    await expect(dcc).toHaveAttribute('aria-pressed', 'true');
    await expect(cellGroup).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('link', { name: /^Record DCC · 1 of 2 marked,/ })).toHaveCount(2);
    await expect(page.getByRole('link', { name: /^Record Young Pro · / })).toHaveCount(0);

    await cellGroup.click();
    await expect(page.getByRole('link', { name: /^Record Young Pro · Sat,/ })).toBeVisible();

    // The old Show choice and its words are gone.
    await expect(page.getByRole('group', { name: 'Show', exact: true })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Sundays' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'All', exact: true })).toHaveCount(0);
  });

  // Decision 0343: Record carries no month figures, so it asks for no report; the Sundays are
  // still read without the coverage figure nothing here shows (checklist row perf-record-load).
  test('carries no month figures and asks for no report', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);
    const reports: string[] = [];
    const coverageAsked: (string | null)[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/v1/reports/')) reports.push(url.pathname);
      if (url.pathname === '/api/v1/dcc/events') coverageAsked.push(url.searchParams.get('coverage'));
    });

    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: /^Record Young Pro · Sat,/ }).first()).toBeVisible();

    await expect(page.getByRole('complementary', { name: 'June so far' })).toHaveCount(0);
    await expect(page.getByText('Cell meetings recorded')).toHaveCount(0);
    expect(reports).toEqual([]);
    expect(coverageAsked.length).toBeGreaterThan(0);
    expect(coverageAsked.every((value) => value === 'false')).toBe(true);
  });

  test('DCC with My own Cells shows the reader’s own checklist across the month', async ({
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

  });

  // Decision 0301 reverses decision 0258's point 4: Leaders Under Me lists DCC too.
  test('Leaders Under Me lists who still owes DCC, and opens a leader’s checklist', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);
    await mockDccOwed(page);

    await page.goto('/dashboard');
    await chooseDcc(page);
    // Two choices in quick succession can race in the address (a checklist row records it).
    await expect(page).toHaveURL(/kind=dcc/);
    await page.getByRole('radio', { name: 'Leaders Under Me' }).check();

    // One line per leader, by first name (decisions 0311 and 0359): Carlo, then The reader.
    const region = page.getByRole('region', { name: 'Update Records' });
    const owedLines = region.getByRole('button', { name: /^(The reader \(you\)|Carlo Reyes)$/ });
    await expect(owedLines).toHaveCount(2);
    await expect(owedLines.nth(0)).toHaveAccessibleName('Carlo Reyes');
    await expect(owedLines.nth(1)).toHaveAccessibleName('The reader (you)');
    await region.getByRole('button', { name: 'Carlo Reyes' }).click();
    await region.getByRole('button', { name: 'The reader (you)' }).click();

    const list = page.getByRole('table', { name: 'DCC still to record, Carlo Reyes' });
    await expect(list.getByRole('row', { name: /Carlo Reyes/ })).toContainText('See checklist');
    await expect(
      page
        .getByRole('table', { name: 'DCC still to record, The reader (you)' })
        .getByRole('row', { name: /You/ })
        .getByRole('link', { name: /^Record/ }),
    ).toHaveAttribute('href', '/dcc/3f1b7c6e-0000-4000-8000-000000000501');
    await expect(
      awaitingHalves(page).getByRole('button', { name: /^DCC\s*2$/ }),
    ).toBeVisible();

    // The reader's own grid stays until a leader is chosen.
    await expect(page.getByRole('table', { name: /Your DCC checklist by Sunday/ })).toBeVisible();

    await list.getByRole('button', { name: /See checklist/ }).click();
    // The checklist opens at the foot of the page, so the page is taken to it.
    const theirHeading = page.getByRole('heading', { name: /Carlo Reyes’s DCC checklist/ });
    await expect(theirHeading).toBeFocused();
    await expect(theirHeading).toBeInViewport();
    const theirs = page.getByRole('table', { name: /Carlo Reyes’s DCC checklist by Sunday/ });
    await expect(theirs.getByRole('row', { name: /Benito Lagman/ })).toContainText('Not recorded yet');
    await expect(theirs.getByRole('row', { name: /Danilo Suarez/ })).toContainText('Present');
    await expect(page.getByRole('table', { name: /Your DCC checklist by Sunday/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Back to your checklist' }).click();
    await expect(page.getByRole('table', { name: /Your DCC checklist by Sunday/ })).toBeVisible();
    // And back to the row it was opened from.
    await expect(list.getByRole('button', { name: /See checklist/ })).toBeFocused();
  });

  // Decision 0313: another leader's row carries Record beside See checklist, where the API
  // says the reader may record for them, and Record opens that leader's Sunday screen.
  test('another leader’s row carries Record beside See checklist, opening their Sunday', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);
    await mockDccOwed(page);

    await page.goto('/dashboard?kind=dcc&whose=branch');
    const region = page.getByRole('region', { name: 'Update Records' });
    await region.getByRole('button', { name: 'Carlo Reyes' }).click();

    const row = page
      .getByRole('table', { name: 'DCC still to record, Carlo Reyes' })
      .getByRole('row', { name: /Carlo Reyes/ });
    await expect(row.getByRole('link', { name: /^Record/ })).toHaveAttribute(
      'href',
      `/dcc/3f1b7c6e-0000-4000-8000-000000000501?leader=${OWED_LEADER_ID}`,
    );
    await expect(row.getByRole('button', { name: /See checklist/ })).toBeVisible();
  });

  test('a row the reader may not record for keeps See checklist alone', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockQueue(page);
    await mockDccOwed(page);
    // Registered last, so it is the one matched: the API says no Record for Carlo.
    await page.route('**/api/v1/dcc/owed?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reporting_month: '2026-06-01',
          open: true,
          data: [
            {
              event_id: '3f1b7c6e-0000-4000-8000-000000000501',
              event_date: '2026-06-07',
              leader: {
                person_id: OWED_LEADER_ID,
                member_id: 'M-000711',
                full_name: 'Carlo Reyes',
                last_name: 'Reyes',
                first_name: 'Carlo',
                is_actor: false,
                recorded_by_you: false,
              },
              record_for: null,
              may_record: false,
            },
          ],
        }),
      }),
    );

    await page.goto('/dashboard?kind=dcc&whose=branch');
    await page
      .getByRole('region', { name: 'Update Records' })
      .getByRole('button', { name: 'Carlo Reyes' })
      .click();

    const row = page
      .getByRole('table', { name: 'DCC still to record, Carlo Reyes' })
      .getByRole('row', { name: /Carlo Reyes/ });
    await expect(row.getByRole('button', { name: /See checklist/ })).toBeVisible();
    await expect(row.getByRole('link', { name: /^Record/ })).toHaveCount(0);
  });
});

test.describe('recording a Sunday for another leader (decision 0313)', () => {
  const FOR_CARLO = `/dcc/3f1b7c6e-0000-4000-8000-000000000501?leader=${OWED_LEADER_ID}`;

  test('says whose checklist it is, in their sections, and saves only what was marked', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockLeaderDccRoster(page);
    const sent: unknown[] = [];
    await page.route('**/api/v1/dcc/events/*/submit', async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto(FOR_CARLO);

    await expect(page.getByText('Recording for Carlo Reyes.')).toBeVisible();
    await expect(
      page.getByText(/It is saved under your name, and Carlo Reyes sees it on their own checklist\./),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to your own checklist' })).toHaveAttribute(
      'href',
      '/dcc/3f1b7c6e-0000-4000-8000-000000000501',
    );
    await expect(page.getByRole('heading', { name: /^Carlo Reyes’s 12/ })).toBeVisible();
    await expect(page.getByText('The 2 people on Carlo Reyes’s checklist.', { exact: false })).toBeVisible();

    await page
      .getByRole('group', { name: 'Danilo Suarez' })
      .getByRole('radio', { name: 'Present' })
      .check();
    await page.getByRole('button', { name: 'Save marks', exact: true }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({
      records: [
        { person_id: '3f1b7c6e-0000-4000-8000-000000000612', present: true, version: 1 },
        { person_id: '3f1b7c6e-0000-4000-8000-000000000613', present: true, version: null },
      ],
    });
  });

  test('says the leader will see it once their account is active, where it is not', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockLeaderDccRoster(page, { active: false });

    await page.goto(FOR_CARLO);

    await expect(
      page.getByText(/Carlo Reyes will see it once their account is active\./),
    ).toBeVisible();
  });
});

/**
 * Record opens on four lists, one at a time (SKILL.md section 19, decision 0290).
 *
 * Four buttons of one size choose the list (decision 0332), each carrying its count; a list read a page at a
 * time counts what it has read and says there is more. Each list is a table from `lg`
 * and a card per row below it, and the two lists of people show everybody, fifty at a
 * time, with Show more.
 */
test.describe('Record’s three lists (decisions 0290 and 0381)', () => {
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
    await mockPendingDcc(page);
    await mockDccOwed(page);
    // One Cell still to record (decision 0368).
    await mockPendingCg(page, [PENDING_CG_ROWS[0]]);
  }

  test('keeps the list, the half and whose in the address, so Back returns to each', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    // A whole-church reader, who has Whose (decision 0382).
    await mockWholeChurchReader(page);
    await page.goto('/dashboard');

    await chooseList(page, /^Pending CG Records/);
    await expect(page).toHaveURL(/list=behind/);

    await chooseList(page, /^Update Records/);
    await expect(page).not.toHaveURL(/list=/);
    await chooseDcc(page);
    await expect(page).toHaveURL(/kind=dcc/);
    await page.getByRole('radio', { name: 'Leaders Under Me' }).check();
    await expect(page).toHaveURL(/whose=branch/);

    // Leaving the screen and coming back, which is what losing it looked like.
    await page.goto('/cells');
    await page.goBack();
    await expect(
      awaitingHalves(page).getByRole('button', { name: /^DCC/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('radio', { name: 'Leaders Under Me' })).toBeChecked();

    await page.goBack();
    await expect(page.getByRole('radio', { name: 'Own ' })).toBeChecked();
    await page.goBack();
    await expect(
      awaitingHalves(page).getByRole('button', { name: /^Cell Group/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.goBack();
    await expect(recordLists(page).getByRole('button', { name: /^Pending CG Records/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('keeps both of two choices made before the first has reached the address', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    await mockWholeChurchReader(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('radio', { name: 'Leaders Under Me' })).toBeVisible();

    // Hold every navigation's server round trip until the second click has been made, so
    // it lands while the first is still on its way — which is what a quick reader on a
    // slow line does. A fixed delay could run out first on a slow runner.
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      (url) => url.searchParams.has('_rsc'),
      async (route) => {
        await released;
        await route.continue();
      },
    );

    await chooseDcc(page);
    await page.getByRole('radio', { name: 'Leaders Under Me' }).check();
    release();

    await expect(page).toHaveURL(/kind=dcc/);
    await expect(page).toHaveURL(/whose=branch/);

    // Back returns to an address from before the second choice. Whether the two choices
    // made one history entry or two is Next's router's to decide, and it decides both ways
    // (checklist row test-flaky-record-address).
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard(\?kind=dcc)?$/);
  });

  /**
   * A list over two pages: the first carries a cursor, the second does not. Every cursor asked for is kept, so a case can say a second page was read.
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

  test('opens on three buttons of one size, each with its count, Update Records chosen', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto('/dashboard');

    const lists = recordLists(page);
    await expect(lists.getByRole('button')).toHaveCount(3);
    // Two meetings of the reader's own and two Sundays; one Cell behind; no leader behind on
    // DCC. The two people lists are on Cells and People (decision 0381).
    for (const name of [
      /^Update Records\s*4$/,
      /^Pending CG Records\s*1$/,
      // A count of 0 is left off (decision 0349).
      /^Pending DCC Records$/,
    ]) {
      await expect(lists.getByRole('button', { name })).toBeVisible();
    }
    await expect(lists.getByRole('button', { name: /^Update Records/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const name of [
      /^Pending CG Records/,
      /^Pending DCC Records/,
    ]) {
      await expect(lists.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }

    // One size, as wide as the longest label (decision 0332): one row of three, all equal.
    const { widths, tops } = await lists.evaluate((group) => {
      const buttons = [...group.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
      return {
        widths: buttons.map((rect) => Math.round(rect.width)),
        tops: new Set(buttons.map((rect) => Math.round(rect.top))).size,
      };
    });
    expect(tops).toBe(1);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);

    // Only the chosen list is on the page, and the tab names it: no heading repeats the name
    // inside it (decision 0362).
    await expect(page.getByRole('region', { name: 'Update Records' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Update Records' })).toHaveCount(0);
    await expect(page.getByText(/^Still to record this month/)).toHaveCount(0);
    for (const name of [
      'Pending CG Records',
      'Pending DCC Records',
      'Awaiting Leader Assignment',
      'Awaiting CG Assignment',
    ]) {
      await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
    }
  });

  test('Pending DCC Records lists each leader once, with each open Sunday and who records it (decision 0336)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    const asked = await mockPendingDcc(page, PENDING_DCC_ROWS);
    await mockDccOwed(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto('/dashboard?list=dcc');

    await expect(recordLists(page).getByRole('button', { name: /^Pending DCC Records\s*2$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const table = page.getByRole('table', { name: 'Pending DCC Records' });
    await expect(table.getByRole('columnheader')).toHaveText(['Leader', 'Sundays still to record', 'Action']);

    // The reader's own row records; Late is a word, never a colour.
    const own = table.getByRole('row').filter({ hasText: 'You' });
    await expect(own).toContainText('Late · closes');
    await expect(own.getByRole('link', { name: /^Record/ })).toHaveAttribute(
      'href',
      '/dcc/3f1b7c6e-0000-4000-8000-000000000501',
    );

    // A leader with no account: who records it, each Sunday on its own line, and See
    // checklist alone, since the reader may not record there.
    const carlo = table.getByRole('row').filter({ hasText: 'Carlo Reyes' });
    await expect(carlo).toContainText('Has no account · Recorded by Jose Santos');
    await expect(carlo.getByRole('listitem')).toHaveCount(2);
    await expect(carlo.getByRole('link', { name: /^Record/ })).toHaveCount(0);
    await carlo.getByRole('button', { name: /^See checklist/ }).click();
    await expect(page.getByRole('heading', { name: 'Carlo Reyes’s DCC checklist' })).toBeVisible();

    // A search goes to the server; a one-letter term is not sent.
    const search = page.getByLabel('Search a leader by name or Member ID');
    await search.fill('r');
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled();
    await search.fill('reyes');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => asked.some((query) => query.includes('q=reyes'))).toBe(true);

    // Emptied, the box offers Clear search, as every list does (owner, 2026-10-13).
    await search.fill('');
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
  });

  test('a list with a further page unread counts what it read and says there is more', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    // Pending CG Records is read fifty at a time too (decision 0368).
    await mockTwoPages(page, '**/api/v1/cells/meetings/pending*', [PENDING_CG_ROWS[0]], [PENDING_CG_ROWS[1]]);

    await page.goto('/dashboard');

    const lists = recordLists(page);
    await expect(lists.getByRole('button', { name: /^Pending CG Records\s*1\+$/ })).toBeVisible();
    // The queue is read whole, so its count carries no "+".
    await expect(lists.getByRole('button', { name: /^Update Records\s*4$/ })).toBeVisible();
  });

  test('switches between the lists, showing one at a time', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto('/dashboard');

    await chooseList(page, /^Pending CG Records/);
    await expect(recordLists(page).getByRole('button', { name: /^Pending CG Records/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(recordLists(page).getByRole('button', { name: /^Update Records/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByRole('region', { name: 'Update Records' })).toHaveCount(0);
    const behind = page.getByRole('table', { name: 'Pending CG Records' });
    // Laid out as Pending DCC Records is (decision 0368).
    await expect(behind.getByRole('columnheader')).toHaveText(['Cell', 'Meetings still to record', 'Action']);
    const row = behind.getByRole('row').filter({ hasText: 'Carlo Reyes' });
    await expect(row).toContainText('Youth · Sat');
    await expect(row.getByRole('link', { name: /^See meeting/ })).toHaveAttribute(
      'href',
      /^\/cells\/3f1b7c6e-0000-4000-8000-000000000101\/meetings\?month=\d{4}-\d{2}-01$/,
    );

    // The two people lists left Record (decision 0381).
    for (const name of [/^Awaiting Leader Assignment/, /^Awaiting CG Assignment/]) {
      await expect(recordLists(page).getByRole('button', { name })).toHaveCount(0);
    }

    await chooseList(page, /^Update Records/);
    await expect(page.getByRole('region', { name: 'Update Records' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pending CG Records' })).toHaveCount(0);
  });

  // A long tab label squeezed its count narrower than the number, which ran over the box's
  // edge (owner, 2026-10-19). The widest count a list shows is "50+", so every box is given
  // it and measured, on the narrowest phone and on a computer.
  for (const width of [320, 1280]) {
    test(`every count box holds "50+" at ${width}px, filled, the chosen tab's the other way round`, async ({
      page,
    }) => {
      await page.clock.setFixedTime(JUNE_20);
      await mockRecord(page);
      await page.setViewportSize({ width, height: 800 });

      await page.goto('/dashboard');
      const boxes = recordLists(page).locator('button > span');
      await expect(boxes.first()).toBeVisible();
      const measured = await boxes.evaluateAll((spans) =>
        spans.map((span) => {
          span.textContent = '50+';
          const button = getComputedStyle(span.parentElement!);
          const box = getComputedStyle(span);

          return {
            fits: span.scrollWidth <= span.clientWidth,
            // Filled with its tab's words' colour: the accent, or on the chosen tab the page's.
            filled: box.backgroundColor === button.color,
          };
        }),
      );

      expect(measured.length).toBeGreaterThan(1);
      expect(measured.every((box) => box.fits)).toBe(true);
      expect(measured.every((box) => box.filled)).toBe(true);
    });
  }

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

      const record = page.getByRole('link', { name: /^Record Young Pro · Sat,/ });
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

      // Pending CG Records is cards too.
      await chooseList(page, /^Pending CG Records/);
      await expect(page.getByRole('table', { name: 'Pending CG Records' })).toBeHidden();
      await expect(
        page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Carlo Reyes' }) }),
      ).toBeVisible();
    });
  }

  test('from lg each list is a table, and the cards are not shown', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto('/dashboard');

    const record = page.getByRole('link', { name: /^Record Young Pro · Sat,/ });
    await expect(record).toBeVisible();
    await expect(awaitingTable(page)).toBeVisible();
    // The one visible Record button for that meeting is the table's.
    await expect(record.locator('xpath=ancestor::table')).toHaveCount(1);

    for (const name of ['Pending CG Records']) {
      await chooseList(page, new RegExp(`^${name}`));
      const table = page.getByRole('table', { name });
      await expect(table).toBeVisible();
      await expect(table.getByRole('link').first()).toBeVisible();
      await expect(page.locator('main ul.lg\\:hidden')).toBeHidden();
    }
  });
});

/** Record's list buttons (decisions 0290 and 0381). */
function recordLists(page: Page) {
  return page.getByRole('group', { name: 'Outstanding work', exact: true });
}

async function chooseList(page: Page, name: RegExp) {
  const button = recordLists(page).getByRole('button', { name });
  // Under a loaded suite the page can reload itself just after a click, landing back on
  // the list it came from, so the click is repeated until this list is the chosen one.
  await expect(async () => {
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}

/** Awaiting a record's two halves, Cell Group and DCC (decision 0290). */
function awaitingHalves(page: Page) {
  return page.getByRole('group', { name: 'Update Records', exact: true });
}

async function chooseDcc(page: Page) {
  await awaitingHalves(page).getByRole('button', { name: /^DCC/ }).click();
}

/** The queue as a table, which is what is shown from `lg`. */
function awaitingTable(page: Page) {
  return page.getByRole('table', { name: 'Update Records', exact: true });
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
    await expect(grid.getByText('Not recorded · 1 to mark').first()).toBeVisible();
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
    await expect(grid.getByText('Not recorded · week closed · 1 unmarked').first()).toBeVisible();
    await expect(grid.getByText('Not recorded', { exact: true })).toHaveCount(0);
    await expect(grid.getByText(/to mark/)).toHaveCount(0);
    await expect(
      grid.locator('td', { hasText: 'week closed' }).locator('a[href^="/dcc/"]'),
    ).toHaveCount(0);
  });

  // Decision 0335: inside an open month a week can close, and each row reads its own week,
  // from the server: a meeting is open while the recording queue lists it, a Sunday while it
  // is recordable. The month-level flag would offer both closed rows here.
  test('an open month shows a closed week as closed, with nothing to open', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockMonth(page);
    const unrecorded = (day: string, week: string) => ({
      scheduled_date: day,
      scheduled_time: '19:00',
      week_starting: week,
      reporting_month: '2026-06-01',
      meeting: null,
    });
    await page.route('**/api/v1/cells/*/meetings?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cell_id: 'CELL-000007',
          category: 'YOUTH',
          day_of_week: 6,
          scheduled_time: '19:00',
          leader: { id: '3f1b7c6e-0000-4000-8000-000000000201', full_name: 'Teofilo Ramos' },
          member_count: 2,
          cell_closed_on: null,
          reporting_month: '2026-06-01',
          scheduled_count: 2,
          recorded_count: 0,
          meetings: [unrecorded('2026-06-06', '2026-06-01'), unrecorded('2026-06-13', '2026-06-08')],
        }),
      }),
    );
    // The queue lists the 13th alone: the week of the 6th has closed.
    await mockMeetingsAwaiting(page, {
      '2026-06-01': { meetings: [awaitingRow('2026-06-13', '2026-06-01')] },
    });
    await page.route('**/api/v1/dcc/events?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reporting_month: '2026-06-01',
          open: true,
          data: [
            {
              id: '3f1b7c6e-0000-4000-8000-000000000501',
              event_date: '2026-06-07',
              recordable: false,
              not_recordable_reason: 'MONTH_CLOSED',
              removed: false,
              removal_reason: null,
              coverage: null,
            },
          ],
        }),
      }),
    );

    await page.goto('/dcc');

    const grid = page.getByRole('table', { name: 'Every date you owe a record this month' });
    // A calendar: each day is a cell, and every Cell the reader leads gets this month's mock.
    const day = (n: number) => grid.getByRole('cell').filter({ hasText: new RegExp(`^${n}(?!\\d)`) });
    await expect(day(6)).toContainText('Not recorded · week closed');
    await expect(day(6).getByRole('link')).toHaveCount(0);
    await expect(day(13).getByRole('link', { name: /Saturday 13 June/ })).toHaveAttribute(
      'href',
      `/cells/${CELL_WITH_MEETINGS.id}/meetings/2026-06-13`,
    );
    await expect(day(13).getByText('Not recorded', { exact: true })).toBeVisible();
    await expect(day(7)).toContainText('Not recorded · week closed · 1 unmarked');
    await expect(day(7).getByRole('link')).toHaveCount(0);
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

  // Hidden rather than withdrawn (owner, 2026-10-23): the month page still opens by
  // address, as the cases above show, and nothing on Record links to it for now.
  test('the queue does not link to it for now', async ({ page }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockMonth(page);
    await mockCellReport(page);
    await mockDccReport(page);
    await mockAwaitingReassignment(page);
    await mockPeopleWithoutACell(page);
    await mockPendingDcc(page);

    await page.goto('/dashboard?kind=dcc');

    await expect(page.getByRole('heading', { name: /Your DCC checklist/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'See the whole month' })).toHaveCount(0);
    await expect(page.locator('main a[href="/dcc"]')).toHaveCount(0);
  });
});

/**
 * A DCC checklist longer than one page (fifty people). The Record page counted the first
 * page alone, so a checklist whose first fifty were marked read as done while somebody
 * past the fiftieth was not.
 */
test.describe('a DCC checklist longer than one page', () => {
  test('counts every page, so somebody past the fiftieth still makes the Sunday outstanding', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-06-20T02:00:00Z'));
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellMeetings(page);
    await mockMeetingsAwaiting(page, {});
    await mockCellReport(page);
    await mockDccReport(page);
    await mockDccEvents(page);
    await mockAwaitingReassignment(page);
    await mockPeopleWithoutACell(page);
    await mockPendingDcc(page);

    const line = (n: number, marked: boolean) => ({
      person_id: `3f1b7c6e-0000-4000-8000-0000000071${String(n).padStart(2, '0')}`,
      member_id: `M-0071${String(n).padStart(2, '0')}`,
      full_name: `Person ${String(n).padStart(2, '0')}`,
      first_name: `Person ${String(n).padStart(2, '0')}`,
      last_name: 'Test',
      responsible_leader_id: '3f1b7c6e-0000-4000-8000-000000000201',
      record: marked ? { present: true, version: 1, recorded_at: '2026-06-07T12:00:00.000Z' } : null,
    });
    const event = {
      id: '3f1b7c6e-0000-4000-8000-000000000501',
      event_date: '2026-06-07',
      recordable: true,
      not_recordable_reason: null,
      removed: false,
      removal_reason: null,
      coverage: null,
    };
    await page.route('**/api/v1/dcc/events/*/roster*', (route) => {
      const second = new URL(route.request().url()).searchParams.get('cursor') === 'page-two';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          second
            ? { event, data: [line(51, false)], next_cursor: null }
            : {
                event,
                data: Array.from({ length: 50 }, (_, index) => line(index + 1, true)),
                next_cursor: 'page-two',
              },
        ),
      });
    });

    await page.goto('/dashboard');
    await chooseDcc(page);

    // Both recordable Sundays share the mocked checklist: fifty marked and one not.
    await expect(
      awaitingHalves(page).getByRole('button', { name: /^DCC\s*2$/ }),
    ).toBeVisible();
    await expect(page.getByText('DCC · 50 of 51 marked').first()).toBeVisible();
  });

  // Checklist row perf-dcc-checklist: every page builds the whole checklist on the server,
  // so a checklist is read 200 at a time rather than fifty.
  test('reads a checklist of 120 in one request per Sunday', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-06-20T02:00:00Z'));
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellMeetings(page);
    await mockMeetingsAwaiting(page, {});
    await mockCellReport(page);
    await mockDccReport(page);
    await mockDccEvents(page);
    await mockAwaitingReassignment(page);
    await mockPeopleWithoutACell(page);
    await mockPendingDcc(page);

    const lines = Array.from({ length: 120 }, (_, index) => ({
      person_id: `3f1b7c6e-0000-4000-8000-000000072${String(index).padStart(3, '0')}`,
      member_id: `M-072${String(index).padStart(3, '0')}`,
      full_name: `Person ${String(index).padStart(3, '0')}`,
      first_name: `Person ${String(index).padStart(3, '0')}`,
      last_name: 'Test',
      responsible_leader_id: '3f1b7c6e-0000-4000-8000-000000000201',
      record: index === 119 ? null : { present: true, version: 1, recorded_at: '2026-06-07T12:00:00.000Z' },
    }));
    const asked: URL[] = [];
    await page.route('**/api/v1/dcc/events/*/roster*', (route) => {
      const url = new URL(route.request().url());
      asked.push(url);
      const start = Number(url.searchParams.get('cursor') ?? '0');
      const end = start + Number(url.searchParams.get('limit') ?? '50');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          event: {
            id: '3f1b7c6e-0000-4000-8000-000000000501',
            event_date: '2026-06-07',
            recordable: true,
            not_recordable_reason: null,
            removed: false,
            removal_reason: null,
            coverage: null,
          },
          data: lines.slice(start, end),
          next_cursor: end < lines.length ? String(end) : null,
        }),
      });
    });

    await page.goto('/dashboard');
    await chooseDcc(page);

    await expect(page.getByText('DCC · 119 of 120 marked').first()).toBeVisible();
    const sundays = new Set(asked.map((url) => url.pathname));
    expect(asked).toHaveLength(sundays.size);
    expect(asked.every((url) => url.searchParams.get('limit') === '200')).toBe(true);
  });
});

test.describe('Pending CG Records laid out as Pending DCC Records (decision 0368)', () => {
  /** 10:00 on 20 June 2026 in Manila. */
  const JUNE_20 = new Date('2026-06-20T02:00:00Z');

  async function mockRecord(page: Page) {
    await page.clock.setFixedTime(JUNE_20);
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellMeetings(page);
    await mockMeetingsAwaiting(page, {});
    await mockCellReport(page);
    await mockDccReport(page);
    await mockDccEvents(page);
    await mockDccRoster(page);
    await mockAwaitingReassignment(page);
    await mockPeopleWithoutACell(page);
    await mockPendingDcc(page);
    await mockDccOwed(page);
  }

  const table = (page: Page) => page.getByRole('table', { name: 'Pending CG Records', exact: true });

  test('names each Cell by its leader, each meeting on its own line, with Record and See meeting', async ({
    page,
  }) => {
    await mockRecord(page);
    await mockPendingCg(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/dashboard?list=behind');

    await expect(table(page).getByRole('columnheader')).toHaveText([
      'Cell',
      'Meetings still to record',
      'Action',
    ]);
    const carlo = table(page).getByRole('row').filter({ hasText: 'Carlo Reyes' });
    await expect(carlo).toContainText('Youth · Sat');
    await expect(carlo.getByRole('listitem')).toHaveCount(2);
    // Late is a word, never a colour (decision 0335).
    await expect(carlo.getByRole('listitem').first()).toContainText('Saturday 6 June · Late · closes');
    await expect(carlo.getByRole('link', { name: /^Record/ })).toHaveAttribute(
      'href',
      '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings/2026-06-06',
    );
    await expect(carlo.getByRole('link', { name: /^See meeting/ })).toHaveAttribute(
      'href',
      '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings?month=2026-06-01',
    );
    await expect(carlo.getByRole('link', { name: 'Carlo Reyes' })).toHaveAttribute(
      'href',
      '/people/3f1b7c6e-0000-4000-8000-000000000611',
    );

    // A closed Cell says so, and one the reader may not record carries See meeting alone.
    const herminia = table(page).getByRole('row').filter({ hasText: 'Herminia Lazaro' });
    await expect(herminia).toContainText('Couple · Wed · Closed 12 Jun 2026');
    await expect(herminia.getByRole('link', { name: /^Record/ })).toHaveCount(0);
    await expect(herminia.getByRole('link', { name: /^See meeting/ })).toBeVisible();
    await expect(recordLists(page).getByRole('button', { name: /^Pending CG Records\s*2$/ })).toBeVisible();
  });

  test('asks the server for each narrowing, Late only included, and never reorders', async ({ page }) => {
    await mockRecord(page);
    const asked = await mockPendingCg(page);
    await page.goto('/dashboard?list=behind');
    await expect(table(page).getByRole('row').filter({ hasText: 'Carlo Reyes' })).toBeVisible();

    const pane = page.getByRole('region', { name: 'Pending CG Records' });
    await pane.getByLabel('Search by Cell ID or leader').fill('cell-0000');
    await pane.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => asked.some((query) => query.includes('q=cell-0000'))).toBe(true);

    const late = pane.getByRole('button', { name: 'Late only' });
    await expect(late).toHaveAttribute('aria-pressed', 'false');
    await late.click();
    await expect(pane.getByRole('button', { name: 'Showing late only' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect.poll(() => asked.some((query) => query.includes('late=true'))).toBe(true);
    // The Network filter is a whole-church reader's alone (decision 0336).
    await expect(pane.getByRole('radiogroup', { name: 'Network' })).toHaveCount(0);
  });

  test('reads fifty at a time, counts what it has read, and Show more reads the next page', async ({
    page,
  }) => {
    await mockRecord(page);
    const cursors: (string | null)[] = [];
    await page.route('**/api/v1/cells/meetings/pending*', (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      cursors.push(cursor);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          cursor === 'page-two'
            ? { data: [PENDING_CG_ROWS[1]], next_cursor: null }
            : { data: [PENDING_CG_ROWS[0]], next_cursor: 'page-two' },
        ),
      });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/dashboard?list=behind');

    await expect(recordLists(page).getByRole('button', { name: /^Pending CG Records\s*1\+$/ })).toBeVisible();
    await expect(table(page).getByRole('row').filter({ hasText: 'Herminia Lazaro' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(table(page).getByRole('row').filter({ hasText: 'Herminia Lazaro' })).toBeVisible();
    await expect(recordLists(page).getByRole('button', { name: /^Pending CG Records\s*2$/ })).toBeVisible();
    expect(cursors).toContain('page-two');
    // The Cells index is no longer read for this list.
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
  });

  test('a failed read says so and never says that nothing is still to record', async ({ page }) => {
    await mockRecord(page);
    await page.route('**/api/v1/cells/meetings/pending*', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'SCOPE_DENIED', message: 'Outside your scope.', details: {} } }),
      }),
    );
    await page.goto('/dashboard?list=behind');

    await expect(page.locator('main').getByRole('alert').first()).not.toBeEmpty();
    // No count box: the button's whole name is its label.
    await expect(recordLists(page).getByRole('button', { name: 'Pending CG Records', exact: true })).toBeVisible();
    await expect(page.getByText(/No Cell you oversee has a meeting still to record/)).toHaveCount(0);
  });

  test('an empty list says so in one row, and Late only says it in its own words', async ({ page }) => {
    await mockRecord(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/dashboard?list=behind');

    await expect(table(page).getByRole('cell')).toHaveText(['No Cell you oversee has a meeting still to record.']);
    await page.getByRole('region', { name: 'Pending CG Records' }).getByRole('button', { name: 'Late only' }).click();
    await expect(table(page).getByRole('cell')).toHaveText([
      'No Cell you oversee has a meeting past its deadline.',
    ]);
  });
});
test.describe('Awaiting Leader Assignment for a reader who may not move people (decision 0356)', () => {
  const JUNE_20 = new Date('2026-06-20T02:00:00Z');

  async function mockList(page: Page) {
    await page.clock.setFixedTime(JUNE_20);
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
    await mockPendingDcc(page);
    await mockDccOwed(page);
  }

  test('lists the people read-only, saying their Primary chooses a new leader', async ({ page }) => {
    await mockList(page);
    await page.goto('/people/awaiting-leader');

    await expect(page.getByRole('link', { name: 'Amihan Bacani' })).toBeVisible();
    await expect(page.getByText('A new leader is chosen by your Primary.')).toBeVisible();
  });

  test('does not say so to a reader who may move them', async ({ page }) => {
    await mockList(page);
    await mockGrants(page, ['people.manage_pastoral_assignment']);
    await page.goto('/people/awaiting-leader');

    await expect(page.getByRole('link', { name: 'Amihan Bacani' })).toBeVisible();
    await expect(page.getByText('A new leader is chosen by your Primary.')).toHaveCount(0);
  });
});

// Decision 0395: once the leader has marked somebody, one button marks the rest Absent. It
// names how many, leaves every mark made, and is the leader's own press: Save still waits.
test.describe('marking the rest of a Cell meeting Absent', () => {
  const PEOPLE = [
    { id: '3f1b7c6e-0000-4000-8000-000000000611', first: 'Alma', last: 'Reyes' },
    { id: '3f1b7c6e-0000-4000-8000-000000000612', first: 'Benito', last: 'Cruz' },
    { id: '3f1b7c6e-0000-4000-8000-000000000613', first: 'Carla', last: 'Dizon' },
  ];
  const name = (index: number) => `${PEOPLE[index].first} ${PEOPLE[index].last}`;

  /** A roster of three, recorded or not, with each member's stored mark. */
  async function roster(
    page: Page,
    {
      records = [null, null, null],
      recorded = false,
      weekOpen = true,
      mayRecord = true,
    }: {
      records?: (boolean | null)[];
      recorded?: boolean;
      weekOpen?: boolean;
      mayRecord?: boolean;
    } = {},
  ): Promise<void> {
    await page.route('**/api/v1/cells/*/meetings/*/roster', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cell_id: 'CELL-000007',
          meeting_id: '2026-06-27',
          scheduled_date: '2026-06-27',
          scheduled_time: '19:00',
          week_starting: '2026-06-22',
          reporting_month: '2026-06-01',
          roster_date: '2026-06-27',
          responsible_leader_id: '3f1b7c6e-0000-4000-8000-000000000299',
          may_record: mayRecord,
          week_open: weekOpen,
          meeting: recorded
            ? {
                id: '3f1b7c6e-0000-4000-8000-000000000301',
                status: 'HELD',
                scheduled_date: '2026-06-27',
                scheduled_time: '19:00',
                actual_date: null,
                actual_time: null,
                not_held_reason: null,
                not_held_note: null,
                facilitated_by: null,
                responsible_leader_id: '3f1b7c6e-0000-4000-8000-000000000299',
                submitted_by: '3f1b7c6e-0000-4000-8000-000000000299',
                submitted_at: '2026-06-27T13:00:00.000Z',
                version: 3,
              }
            : null,
          members: PEOPLE.map((person, index) => ({
            person_id: person.id,
            member_id: `M-00090${index}`,
            first_name: person.first,
            last_name: person.last,
            full_name: `${person.first} ${person.last}`,
            record: records[index] === null ? null : { present: records[index] },
          })),
        }),
      }),
    );
  }

  const mark = (page: Page, index: number, which: 'Present' | 'Absent') =>
    page.getByRole('group', { name: name(index) }).getByRole('radio', { name: which });

  test('appears only after the first mark, names the rest, and marks only them', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await roster(page);
    const sent = await captureSubmissions(page);

    await page.goto(MEETING);
    const save = page.getByRole('button', { name: 'Save meeting' });
    await expect(mark(page, 0, 'Present')).toBeVisible();
    // Never the first thing a leader can press.
    await expect(page.getByRole('button', { name: /Absent$/ })).toHaveCount(0);

    await mark(page, 0, 'Present').check();
    await expect(page.getByRole('button', { name: 'Mark the other 2 Absent' })).toBeVisible();
    await mark(page, 1, 'Present').check();
    await expect(save).toBeDisabled();
    await page.getByRole('button', { name: 'Mark the 1 left Absent' }).click();

    await expect(mark(page, 0, 'Present')).toBeChecked();
    await expect(mark(page, 1, 'Present')).toBeChecked();
    await expect(mark(page, 2, 'Absent')).toBeChecked();
    await expect(page.getByRole('button', { name: /Absent$/ })).toHaveCount(0);
    // The button is gone, so focus moves on to Save rather than falling to the page.
    await expect(save).toBeEnabled();
    await expect(save).toBeFocused();

    await save.click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({
      status: 'HELD',
      attendance: [
        { person_id: PEOPLE[0].id, present: true },
        { person_id: PEOPLE[1].id, present: true },
        { person_id: PEOPLE[2].id, present: false },
      ],
    });
  });

  test('moves focus to what Save waits for when Save is still not ready', async ({ page }) => {
    await mockSignedIn(page);
    await roster(page);

    await page.goto(MEETING);
    // Somebody else ran it and nobody is chosen yet, so Save waits for that.
    await page.getByRole('radio', { name: 'Someone else' }).check();
    await mark(page, 0, 'Present').check();
    await page.getByRole('button', { name: 'Mark the other 2 Absent' }).click();

    await expect(page.getByRole('button', { name: 'Save meeting' })).toBeDisabled();
    await expect(page.getByText('Choose who ran it to save.')).toBeFocused();
  });

  test('a meeting nobody came to: mark one Absent, then the rest', async ({ page }) => {
    await mockSignedIn(page);
    await roster(page);

    await page.goto(MEETING);
    await mark(page, 1, 'Absent').check();
    await page.getByRole('button', { name: 'Mark the other 2 Absent' }).click();
    for (const index of [0, 1, 2]) {
      await expect(mark(page, index, 'Absent')).toBeChecked();
    }
  });

  test('on a correction, marks only a member with no mark and keeps the stored ones', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellCorrector(page);
    // Alma came and Benito did not; Carla has no mark yet.
    await roster(page, { recorded: true, records: [true, false, null] });

    await page.goto(MEETING);
    // Not being edited: nothing is offered.
    await expect(page.getByText('Already recorded')).toBeVisible();
    await expect(page.getByRole('button', { name: /Absent$/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit meeting' }).click();
    await page.getByRole('button', { name: 'Mark the 1 left Absent' }).click();
    await expect(mark(page, 0, 'Present')).toBeChecked();
    await expect(mark(page, 1, 'Absent')).toBeChecked();
    await expect(mark(page, 2, 'Absent')).toBeChecked();
  });

  test('is not offered where nothing can be recorded, nor on Did not meet', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellCorrector(page);

    // A closed week, and another leader's meeting, each with somebody unmarked.
    await roster(page, { recorded: true, records: [true, null, null], weekOpen: false });
    await page.goto(MEETING);
    await expect(mark(page, 0, 'Present')).toBeVisible();
    await expect(page.getByRole('button', { name: /Absent$/ })).toHaveCount(0);

    await page.unroute('**/api/v1/cells/*/meetings/*/roster');
    await roster(page, { recorded: true, records: [true, null, null], mayRecord: false });
    await page.goto(MEETING);
    await expect(mark(page, 0, 'Present')).toBeVisible();
    await expect(page.getByRole('button', { name: /Absent$/ })).toHaveCount(0);

    await page.unroute('**/api/v1/cells/*/meetings/*/roster');
    await roster(page);
    await page.goto(MEETING);
    await mark(page, 0, 'Present').check();
    await expect(page.getByRole('button', { name: 'Mark the other 2 Absent' })).toBeVisible();
    await page.getByRole('radio', { name: 'Did not meet' }).check();
    await expect(page.getByRole('button', { name: /Absent$/ })).toHaveCount(0);
  });

  test('sits above Save on a phone and beside it from sm', async ({ page }) => {
    await mockSignedIn(page);
    await roster(page);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(MEETING);
    await mark(page, 0, 'Present').check();
    const rest = page.getByRole('button', { name: 'Mark the other 2 Absent' });
    const save = page.getByRole('button', { name: 'Save meeting' });
    const phone = { rest: await rest.boundingBox(), save: await save.boundingBox() };
    expect(phone.rest!.y).toBeLessThan(phone.save!.y);

    await page.setViewportSize({ width: 1024, height: 900 });
    const wide = { rest: await rest.boundingBox(), save: await save.boundingBox() };
    expect(wide.rest!.x).toBeLessThan(wide.save!.x);
  });
});