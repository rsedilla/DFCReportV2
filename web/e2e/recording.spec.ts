import { expect, test, type Page } from '@playwright/test';

import {
  mockAwaitingReassignment,
  mockCellCorrector,
  mockPeopleWithoutACell,
  mockSignedIn,
} from './mock-api';
import {
  mockCellMeetings,
  mockCellReport,
  mockCells,
  mockClosedDccRoster,
  mockDccEvents,
  mockDccReport,
  mockDccRoster,
  mockMeetingRoster,
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

test.describe('the Record queue', () => {
  async function mockRecordScreen(page: Page, { cellsOpen = false }: { cellsOpen?: boolean } = {}) {
    await mockSignedIn(page);
    await mockCells(page, { open: cellsOpen });
    await mockCellMeetings(page);
    await mockCellReport(page);
    await mockDccReport(page);
    await mockDccEvents(page);
    await mockDccRoster(page);
    await mockAwaitingReassignment(page);
    await mockPeopleWithoutACell(page);
  }

  // Section 13 keeps a month open through its 7th and has every leader see their own
  // outstanding work always, so last month's open Sundays are listed until then. The
  // mocks answer every month alike and mark the events open and recordable.
  test('lists last month’s open work in the first seven days, with the day it closes', async ({
    page,
  }) => {
    // 10:00 on 3 October in Manila.
    await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
    await mockRecordScreen(page);

    await page.goto('/dashboard');

    await expect(page.getByText('September · open until 7 Oct').first()).toBeVisible();
  });

  test('lists nothing from last month once the 7th has passed', async ({ page }) => {
    // 10:00 on 8 October in Manila.
    await page.clock.setFixedTime(new Date('2026-10-08T02:00:00Z'));
    await mockRecordScreen(page);

    await page.goto('/dashboard');

    // This month's rows have arrived, so an absence below is not a page still loading.
    await expect(page.getByRole('link', { name: /^Record DCC Sunday/ }).first()).toBeVisible();
    await expect(page.getByText('open until 7 Oct')).toHaveCount(0);
  });

  // The Cell half of the same rule. The server decides whether last month is open, so a
  // Cell's meetings are listed only when the index says so.
  test('lists last month’s Cell meetings in the first seven days while the server has it open', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
    await mockRecordScreen(page, { cellsOpen: true });

    await page.goto('/dashboard');
    await page.getByRole('radio', { name: 'Cells' }).check();

    await expect(page.getByText('September · open until 7 Oct').first()).toBeVisible();
  });

  test('lists no Cell meeting from last month once the server has shut it', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-03T02:00:00Z'));
    await mockRecordScreen(page);

    await page.goto('/dashboard');
    await page.getByRole('radio', { name: 'Cells' }).check();

    // This month's rows have arrived, so an absence below is not a page still loading.
    await expect(page.getByRole('link', { name: /^Record / }).first()).toBeVisible();
    await expect(page.getByText('open until 7 Oct')).toHaveCount(0);
  });

  // Decision 0238: a meeting takes no record before its day, so the queue does not offer one.
  test('leaves a Cell meeting out until its day has come', async ({ page }) => {
    // 10:00 on 20 June in Manila: the meeting of the 27th has not happened.
    await page.clock.setFixedTime(new Date('2026-06-20T02:00:00Z'));
    await mockRecordScreen(page);

    await page.goto('/dashboard');
    await page.getByRole('radio', { name: 'Cells' }).check();

    await expect(page.getByText('No Cell meeting of yours is awaiting a record.')).toBeVisible();
  });

  // A read that failed must not say there is nothing to do (section 19). A refusal is not
  // retried, so the failure arrives at once.
  test('says every Cell has recorded only when the Cells were actually read', async ({ page }) => {
    await mockRecordScreen(page);
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
