import { expect, test, type Page } from '@playwright/test';

import { mockCellCorrector, mockClosedWeekAmender, mockSignedIn } from './mock-api';
import { mockClosedDccRoster, mockRecordedMeetingRoster } from './mock-attendance';

/**
 * The Admin amends a closed week from its own screen (decision 0411).
 *
 * The server already takes an amendment, with its reason, on both saves and decides who may
 * (sections 9 and 13); these cases pin what the screens offer and what they send.
 */

const MEETING = '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings/2026-06-27';
const SUNDAY = '/dcc/3f1b7c6e-0000-4000-8000-000000000501';
const NOTICE = 'This week is closed. Only the Admin may amend it, with a reason that is kept in the audit log.';

/** Captures the body of the next save, answering it as the server would. */
async function captureSave(page: Page, pattern: string, answer: unknown): Promise<unknown[]> {
  const sent: unknown[] = [];
  await page.route(pattern, async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(answer) });
  });
  return sent;
}

test.describe('a Cell meeting in a closed week', () => {
  test('offers a leader no amendment, only the closed page', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellCorrector(page);
    await mockRecordedMeetingRoster(page, 'HELD', { weekOpen: false });

    await page.goto(MEETING);

    await expect(page.getByText('This week is closed, so this meeting can no longer be changed.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Amend Closed Week' })).toHaveCount(0);
  });

  test('lets the Admin amend it with a required reason, and sends the amendment', async ({ page }) => {
    await mockSignedIn(page);
    await mockClosedWeekAmender(page);
    await mockRecordedMeetingRoster(page, 'HELD', { weekOpen: false });
    const sent = await captureSave(page, '**/api/v1/cells/*/meetings/*/submit', { version: 4 });

    await page.goto(MEETING);
    await expect(page.getByText(NOTICE)).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Present' }).first()).toBeDisabled();

    await page.getByRole('button', { name: 'Amend Closed Week' }).click();
    await expect(page.getByText('Amending a closed week')).toBeVisible();
    // The optional correction reason is not asked beside the amendment's own.
    await expect(page.getByLabel(/Why is this changing/)).toHaveCount(0);

    const absent = page.getByRole('radio', { name: 'Absent' }).first();
    await expect(absent).toBeEnabled();
    await absent.check();

    const save = page.getByRole('button', { name: 'Save Amendment' });
    await expect(save).toBeDisabled();
    await expect(page.getByText('Say why this closed week is being amended to save.')).toBeVisible();

    await page.getByLabel(/Why is this closed week being amended/).fill('Marked present by mistake.');
    await expect(save).toBeEnabled();
    await save.click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({
      status: 'HELD',
      version: 3,
      amendment: { reason: 'Marked present by mistake.' },
    });
  });

  test('Cancel leaves the closed week as it was', async ({ page }) => {
    await mockSignedIn(page);
    await mockClosedWeekAmender(page);
    await mockRecordedMeetingRoster(page, 'HELD', { weekOpen: false });

    await page.goto(MEETING);
    await page.getByRole('button', { name: 'Amend Closed Week' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText(NOTICE)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Present' }).first()).toBeDisabled();
  });

  test('asks one reason when whether it met is corrected, and sends it as both', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockClosedWeekAmender(page);
    await mockRecordedMeetingRoster(page, 'HELD', { weekOpen: false });
    const sent = await captureSave(page, '**/api/v1/cells/*/meetings/*/submit', { version: 4 });

    await page.goto(MEETING);
    await page.getByRole('button', { name: 'Amend Closed Week' }).click();
    await page.getByRole('radio', { name: 'Did not meet' }).check();
    await page.getByRole('radio', { name: 'Weather or calamity' }).check();
    // Only the amendment's reason is asked (owner, 2026-10-30).
    await expect(page.getByLabel(/Why is this being corrected/)).toHaveCount(0);
    await page.getByLabel(/Why is this closed week being amended/).fill('It was cancelled for the storm.');
    await page.getByRole('button', { name: 'Save Amendment' }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({
      status: 'NOT_HELD',
      correction_reason: 'It was cancelled for the storm.',
      amendment: { reason: 'It was cancelled for the storm.' },
    });
  });

  test('offers no Save for an amendment that changes nothing', async ({ page }) => {
    await mockSignedIn(page);
    await mockClosedWeekAmender(page);
    await mockRecordedMeetingRoster(page, 'HELD', { weekOpen: false });

    await page.goto(MEETING);
    await page.getByRole('button', { name: 'Amend Closed Week' }).click();
    await page.getByLabel(/Why is this closed week being amended/).fill('Checking.');

    await expect(page.getByRole('button', { name: 'Save Amendment' })).toBeDisabled();
    await expect(page.getByText('Change a mark or the answer above to amend it.')).toBeVisible();
  });

  test('Cancel drops the marks, so the next Amend starts from what is stored', async ({ page }) => {
    await mockSignedIn(page);
    await mockClosedWeekAmender(page);
    await mockRecordedMeetingRoster(page, 'HELD', { weekOpen: false });

    await page.goto(MEETING);
    const amend = page.getByRole('button', { name: 'Amend Closed Week' });
    await amend.click();
    await expect(page.locator('#amending-heading')).toBeFocused();
    const firstAbsent = page.getByRole('radio', { name: 'Absent' }).first();
    await firstAbsent.check();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(amend).toBeFocused();

    await page.reload();
    await page.getByRole('button', { name: 'Amend Closed Week' }).click();
    await expect(page.getByText(/Restored marks/)).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Absent' }).first()).not.toBeChecked();
  });

  test('records a closed meeting that has no record, as an amendment', async ({ page }) => {
    await mockSignedIn(page);
    await mockClosedWeekAmender(page);
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
          had_a_member: true,
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
    const sent = await captureSave(page, '**/api/v1/cells/*/meetings/*/submit', { version: 1 });

    await page.goto(MEETING);
    await expect(page.getByText(NOTICE)).toBeVisible();
    await page.getByRole('button', { name: 'Amend Closed Week' }).click();
    await page.getByRole('radio', { name: 'Present' }).first().check();
    await page.getByLabel(/Why is this closed week being amended/).fill('Found the paper roster.');
    await page.getByRole('button', { name: 'Save Amendment' }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({
      status: 'HELD',
      attendance: [{ person_id: '3f1b7c6e-0000-4000-8000-000000000601', present: true }],
      amendment: { reason: 'Found the paper roster.' },
    });
    expect((sent[0] as { version?: number }).version).toBeUndefined();
  });
});

test.describe('a DCC Sunday in a closed week', () => {
  test('offers a leader no amendment', async ({ page }) => {
    await mockSignedIn(page);
    await mockClosedDccRoster(page);

    await page.goto(SUNDAY);

    await expect(page.getByText('This Sunday takes no record')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Amend Closed Week' })).toHaveCount(0);
  });

  test('offers the Admin nothing on a Sunday with no service', async ({ page }) => {
    await mockSignedIn(page);
    await mockClosedWeekAmender(page);
    await page.route('**/api/v1/dcc/events/*/roster*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          event: {
            id: '3f1b7c6e-0000-4000-8000-000000000501',
            event_date: '2026-06-07',
            recordable: false,
            not_recordable_reason: 'REMOVED',
            removed: true,
            removal_reason: 'Typhoon.',
            coverage: { met: 0, owed: 0 },
          },
          data: [],
          next_cursor: null,
        }),
      }),
    );

    await page.goto(SUNDAY);

    await expect(page.getByText('This Sunday takes no record')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Amend Closed Week' })).toHaveCount(0);
  });

  test('lets the Admin amend it with a required reason, and sends the amendment', async ({ page }) => {
    await mockSignedIn(page);
    await mockClosedWeekAmender(page);
    await mockClosedDccRoster(page);
    const sent = await captureSave(page, '**/api/v1/dcc/events/*/submit', {
      created: 0,
      corrected: 1,
      unchanged: 0,
    });

    await page.goto(SUNDAY);
    await expect(page.getByText(NOTICE)).toBeVisible();

    await page.getByRole('button', { name: 'Amend Closed Week' }).click();
    await expect(page.getByText('Amending a closed week')).toBeVisible();
    await expect(page.getByLabel(/Why is this changing/)).toHaveCount(0);
    const absent = page
      .getByRole('group', { name: 'Rosalinda Ocampo' })
      .getByRole('radio', { name: 'Absent' });
    await expect(absent).toBeEnabled();
    await absent.check();

    const save = page.getByRole('button', { name: 'Save Amendment' });
    await expect(save).toBeDisabled();
    await page.getByLabel(/Why is this closed week being amended/).fill('The paper list arrived late.');
    await expect(save).toBeEnabled();
    await save.click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ amendment: { reason: 'The paper list arrived late.' } });
    expect((sent[0] as { records: { present: boolean }[] }).records[0].present).toBe(false);
  });
});
