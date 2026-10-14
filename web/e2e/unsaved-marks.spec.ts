import { expect, test, type Page } from '@playwright/test';

import { SIGNED_IN_PERSON_ID, mockSignedIn } from './mock-api';
import { mockCellMeetings, mockDccRoster, mockMeetingRoster } from './mock-attendance';

/**
 * Attendance marks not yet saved (owner's choice of 2026-10-14, option C): leaving asks
 * first, and the marks stay on the device, offered back with a note and a Discard until
 * they are saved (`lib/mark-draft.ts`).
 */

const CELL = '3f1b7c6e-0000-4000-8000-000000000101';
const MEETING = `/cells/${CELL}/meetings/2026-06-27`;
const SUNDAY_ID = '3f1b7c6e-0000-4000-8000-000000000501';
const SUNDAY = `/dcc/${SUNDAY_ID}`;
const ROSALINDA = { id: '3f1b7c6e-0000-4000-8000-000000000601', name: 'Rosalinda Ocampo' };
const BIENVENIDO = { id: '3f1b7c6e-0000-4000-8000-000000000602', name: 'Bienvenido Trinidad' };

const MEETING_KEY = `dfc.marks:cell:${CELL}:2026-06-27:${SIGNED_IN_PERSON_ID}`;
const SUNDAY_KEY = `dfc.marks:dcc:${SUNDAY_ID}:own:${SIGNED_IN_PERSON_ID}`;

const RESTORED = /Restored marks you had not saved/;

function radio(page: Page, person: { name: string }, mark: 'Present' | 'Absent') {
  return page.getByRole('group', { name: person.name }).getByRole('radio', { name: mark });
}

function stored(page: Page, key: string): Promise<string | null> {
  return page.evaluate((name) => window.localStorage.getItem(name), key);
}

test.describe('a Cell meeting with marks not yet saved', () => {
  test('asks before an in-app link leaves, and stays when the answer is no', async ({ page }) => {
    await mockSignedIn(page);
    await mockMeetingRoster(page);
    await page.goto(MEETING);
    await radio(page, ROSALINDA, 'Present').check();

    const asked: string[] = [];
    page.once('dialog', async (dialog) => {
      asked.push(dialog.message());
      await dialog.dismiss();
    });
    await page.getByRole('link', { name: 'Back to this Cell’s meetings' }).click();

    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toContain('You have marks you have not saved');
    await expect(page).toHaveURL(MEETING);
    await expect(radio(page, ROSALINDA, 'Present')).toBeChecked();
  });

  test('asks nothing with no marks made', async ({ page }) => {
    await mockSignedIn(page);
    await mockMeetingRoster(page);
    await page.goto(MEETING);
    await expect(radio(page, ROSALINDA, 'Present')).toBeVisible();

    let asked = false;
    page.on('dialog', async (dialog) => {
      asked = true;
      await dialog.accept();
    });
    await page.getByRole('link', { name: 'Back to this Cell’s meetings' }).click();

    await expect(page).toHaveURL(`/cells/${CELL}/meetings`);
    expect(asked).toBe(false);
  });

  test('asks before the tab is closed', async ({ page }) => {
    await mockSignedIn(page);
    await mockMeetingRoster(page);
    await page.goto(MEETING);
    await radio(page, ROSALINDA, 'Present').check();

    const kinds: string[] = [];
    page.on('dialog', async (dialog) => {
      kinds.push(dialog.type());
      await dialog.dismiss();
    });
    await page.close({ runBeforeUnload: true });

    await expect.poll(() => kinds).toEqual(['beforeunload']);
  });

  test('offers the marks back when the screen opens again, and Discard drops them', async ({
    page,
  }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await mockSignedIn(page);
    await mockMeetingRoster(page);
    await page.goto(MEETING);
    await radio(page, ROSALINDA, 'Present').check();
    await radio(page, BIENVENIDO, 'Absent').check();
    await expect.poll(() => stored(page, MEETING_KEY)).not.toBeNull();

    await page.reload();

    await expect(page.getByText(RESTORED)).toBeVisible();
    await expect(radio(page, ROSALINDA, 'Present')).toBeChecked();
    await expect(radio(page, BIENVENIDO, 'Absent')).toBeChecked();

    await page.getByRole('button', { name: 'Discard' }).click();

    await expect(page.getByText(RESTORED)).toHaveCount(0);
    await expect(radio(page, ROSALINDA, 'Present')).not.toBeChecked();
    await expect.poll(() => stored(page, MEETING_KEY)).toBeNull();

    await page.reload();
    await expect(radio(page, ROSALINDA, 'Present')).toBeVisible();
    await expect(page.getByText(RESTORED)).toHaveCount(0);
  });

  test('deletes the kept marks once the meeting is saved, and then asks nothing', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellMeetings(page);
    await mockMeetingRoster(page);
    await page.route('**/api/v1/cells/*/meetings/*/submit', (route) =>
      route.fulfill({ status: 201, contentType: 'application/json', body: '{}' }),
    );
    await page.goto(MEETING);
    await radio(page, ROSALINDA, 'Present').check();
    await radio(page, BIENVENIDO, 'Present').check();
    await expect.poll(() => stored(page, MEETING_KEY)).not.toBeNull();

    await page.getByRole('button', { name: 'Save meeting' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await expect.poll(() => stored(page, MEETING_KEY)).toBeNull();

    let asked = false;
    page.on('dialog', async (dialog) => {
      asked = true;
      await dialog.accept();
    });
    await page.getByRole('link', { name: 'Back to this Cell’s meetings' }).click();
    await expect(page).toHaveURL(`/cells/${CELL}/meetings`);
    expect(asked).toBe(false);
  });

  test('keeps nothing once signed out', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await mockSignedIn(page);
    await mockMeetingRoster(page);
    await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto(MEETING);
    await radio(page, ROSALINDA, 'Present').check();
    await expect.poll(() => stored(page, MEETING_KEY)).not.toBeNull();

    await page.goto('/session');
    expect(await stored(page, MEETING_KEY)).not.toBeNull();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();

    await expect.poll(() => stored(page, MEETING_KEY)).toBeNull();
  });
});
test.describe('a DCC checklist with marks not yet saved', () => {
  test('offers the marks back, and deletes them once saved', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await mockSignedIn(page);
    await mockDccRoster(page);
    await page.route('**/api/v1/dcc/events/*/submit', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.goto(SUNDAY);
    await radio(page, BIENVENIDO, 'Present').check();
    await expect.poll(() => stored(page, SUNDAY_KEY)).not.toBeNull();

    await page.reload();

    await expect(page.getByText(RESTORED)).toBeVisible();
    await expect(radio(page, BIENVENIDO, 'Present')).toBeChecked();

    await page.getByRole('button', { name: 'Save marks', exact: true }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await expect.poll(() => stored(page, SUNDAY_KEY)).toBeNull();
    await expect(page.getByText(RESTORED)).toHaveCount(0);
  });

  test('asks before an in-app link leaves', async ({ page }) => {
    await mockSignedIn(page);
    await mockDccRoster(page);
    await page.goto(SUNDAY);
    await radio(page, BIENVENIDO, 'Absent').check();

    const asked: string[] = [];
    page.once('dialog', async (dialog) => {
      asked.push(dialog.message());
      await dialog.dismiss();
    });
    await page.getByRole('link', { name: 'Back to your month' }).click();

    await expect.poll(() => asked.length).toBe(1);
    await expect(page).toHaveURL(SUNDAY);
  });

  test('does not offer back a mark on a line recorded since it was made', async ({ page }) => {
    // Rosalinda's line is recorded at version 1. A draft made when it was unrecorded
    // (version null) would overwrite a record it never saw.
    await page.addInitScript(
      ([key, person]) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            saved_at: Date.now(),
            value: { [person]: { mark: 'absent', version: null } },
          }),
        );
      },
      [SUNDAY_KEY, ROSALINDA.id],
    );
    await mockSignedIn(page);
    await mockDccRoster(page);
    await page.goto(SUNDAY);

    await expect(radio(page, ROSALINDA, 'Present')).toBeChecked();
    await expect(page.getByText(RESTORED)).toHaveCount(0);
    await expect.poll(() => stored(page, SUNDAY_KEY)).toBeNull();
  });
});
