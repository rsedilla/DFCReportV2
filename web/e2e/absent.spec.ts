import { expect, test, type Page } from '@playwright/test';

import {
  PERSON_IN_SCOPE,
  mockAbsentPeople,
  mockArchivedPeople,
  mockLifecycleAdministrator,
  mockPeople,
  mockScreens,
  mockSignedIn,
} from './mock-api';
import { mockCells } from './mock-attendance';

/**
 * People's *Absent 3+ Months* tab, and archiving and restoring a person (SKILL.md sections 3, 6
 * and 19; decision 0397). A Full view leader reads it with no Archive; the Admin archives,
 * restores, and has the Archived view. Names are invented (CLAUDE.md, Secrets).
 */

/** 10:00 on 20 June 2026 in Manila. */
const JUNE_20 = new Date('2026-06-20T02:00:00Z');

async function arrange(page: Page) {
  await page.clock.setFixedTime(JUNE_20);
  await mockSignedIn(page);
  await mockCells(page);
  await mockPeople(page);
  await mockAbsentPeople(page);
  await mockArchivedPeople(page);
}

const table = (page: Page) => page.getByRole('table', { name: 'Absent 3+ Months' });

test.describe('Absent 3+ Months (decision 0397)', () => {
  test('is the fourth People tab, with no count, read-only for a Full view leader', async ({ page }) => {
    await arrange(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/people/absent');

    const tab = page.getByRole('navigation', { name: 'People' }).getByRole('link').nth(3);
    await expect(tab).toHaveText('Absent 3+ Months');
    await expect(tab).toHaveAttribute('aria-current', 'page');

    await expect(page.getByText(/in March 2026, April 2026 and May 2026/)).toBeVisible();
    await expect(table(page).getByRole('columnheader')).toHaveText([
      'Name',
      'Leader',
      'Cell',
      'Last at Cell',
      'Last at DCC',
    ]);
    await expect(table(page).getByRole('link', { name: 'Dalisay Ocampo' })).toHaveAttribute(
      'href',
      '/people/3f1b7c6e-0000-4000-8000-000000000951',
    );
    await expect(table(page).getByRole('row').nth(1)).toContainText('Never');
    await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Show' })).toHaveCount(0);
    await expect(page.getByText('The administrator archives, after talking with the Senior Pastors.')).toBeVisible();
  });

  test('is not on the recording screens', async ({ page }) => {
    await arrange(page);
    await mockScreens(page, 'RECORDING');
    await page.goto('/people');

    await expect(page.getByRole('link', { name: 'Absent 3+ Months' })).toHaveCount(0);

    await page.goto('/people/absent');
    await expect(page.getByText('This page isn’t part of your screens')).toBeVisible();
  });

  test('gives the Admin Archive, except on the row of somebody leading a Cell', async ({ page }) => {
    await arrange(page);
    await mockLifecycleAdministrator(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/people/absent');

    const rows = table(page).getByRole('row');
    await expect(rows.nth(1).getByRole('button', { name: 'Archive' })).toBeVisible();
    await expect(rows.nth(2).getByRole('button', { name: 'Archive' })).toHaveCount(0);
    await expect(rows.nth(2)).toContainText('Leads CELL-000012 (3 members): hand it over or close it first');
    await expect(rows.nth(2).getByRole('link', { name: 'CELL-000012' })).toHaveAttribute(
      'href',
      '/cells/3f1b7c6e-0000-4000-8000-000000000112/members',
    );
  });

  test('asks why, needs a comment for Other, and asks about the account', async ({ page }) => {
    await arrange(page);
    await mockLifecycleAdministrator(page);
    await page.route('**/api/v1/accounts/for-person/*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ account: { id: 'acc-1', status: 'ACTIVE' } }),
      }),
    );
    const sent: unknown[] = [];
    await page.route('**/api/v1/people/*/archive', (route) => {
      sent.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/people/absent');

    await table(page).getByRole('row').nth(1).getByRole('button', { name: 'Archive' }).click();
    const dialog = page.getByRole('dialog', { name: 'Archive Dalisay Ocampo' });
    await expect(dialog.getByRole('radio')).toHaveCount(9);
    for (const label of [
      'Working away',
      'Studying away',
      'Moved away',
      'Attends another church',
      'Passed away',
      'Record created in error',
      'Other',
    ]) {
      await expect(dialog.getByRole('radio', { name: label, exact: true })).toBeVisible();
    }
    await expect(dialog.getByRole('radio', { name: 'Disable account access' })).toBeChecked();

    const archive = dialog.getByRole('button', { name: 'Archive' });
    await expect(archive).toBeDisabled();
    await dialog.getByRole('radio', { name: 'Other', exact: true }).check();
    await expect(archive).toBeDisabled();
    await dialog.getByLabel('Comment (required)').fill('Asked to be removed');
    await dialog.getByRole('radio', { name: 'Keep account access' }).check();
    await archive.click();

    await expect(dialog).toBeHidden();
    expect(sent).toEqual([{ reason: 'OTHER', note: 'Asked to be removed', account_access: 'KEEP' }]);
  });

  test('has an Archived view for the Admin, with Restore', async ({ page }) => {
    await arrange(page);
    await mockLifecycleAdministrator(page);
    const restored: string[] = [];
    await page.route('**/api/v1/people/*/restore', (route) => {
      restored.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/people/absent');

    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Archived' }).click();
    const archived = page.getByRole('table', { name: 'Archived' });
    await expect(archived.getByRole('columnheader')).toHaveText([
      'Name',
      'Leader',
      'Was in Cell',
      'Archived on',
      'Why',
      '',
    ]);
    await expect(archived.getByRole('row').nth(1)).toContainText('2 Jun 2026');
    await expect(archived.getByRole('row').nth(1)).toContainText('Moved away');

    await archived.getByRole('button', { name: 'Restore' }).click();
    await expect.poll(() => restored.length).toBe(1);
    expect(restored[0]).toContain('/api/v1/people/3f1b7c6e-0000-4000-8000-000000000961/restore');
  });
});

test.describe('A person’s page (decision 0397)', () => {
  test('keeps a read-only archived line, with Restore for the Admin alone', async ({ page }) => {
    await arrange(page);
    await page.route(`**/api/v1/people/${PERSON_IN_SCOPE.id}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...PERSON_IN_SCOPE,
          archived: { archived_at: '2026-06-02T03:00:00.000Z', reason: 'PASSED_AWAY', note: 'Peacefully, at home' },
        }),
      }),
    );
    await page.goto(`/people/${PERSON_IN_SCOPE.id}`);

    await expect(page.getByText('on 2 Jun 2026 · Passed away')).toBeVisible();
    await expect(page.getByText('Peacefully, at home')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);
  });
});
