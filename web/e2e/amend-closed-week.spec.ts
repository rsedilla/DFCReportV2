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
});

test.describe('a DCC Sunday in a closed week', () => {
  test('offers a leader no amendment', async ({ page }) => {
    await mockSignedIn(page);
    await mockClosedDccRoster(page);

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
