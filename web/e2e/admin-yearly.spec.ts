import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn, mockWholeChurchReader } from './mock-api';
import { mockCellReport, mockDccReport } from './mock-attendance';
import { mockChurchCounts, mockTrends } from './mock-senior-pastor';

/**
 * The Admin's five twelve-month graphs (SKILL.md section 19, decisions 0443 and 0459): *Yearly*
 * on Attendance's two figures and on Counts' three, the same graph the Senior Pastors read.
 * Names are invented (CLAUDE.md, Secrets).
 */

async function admin(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-08T02:00:00Z'));
  await mockSignedIn(page);
  await mockWholeChurchReader(page);
  await mockCellReport(page);
  await mockDccReport(page);
  await mockChurchCounts(page);
  return mockTrends(page);
}

const period = (page: Page) => page.getByRole('group', { name: 'Report period' });
const counts = (page: Page) => page.getByRole('group', { name: 'Which count' });
const report = (page: Page) => page.getByRole('navigation', { name: 'Which report' });
const graphShown = (page: Page) =>
  expect(page.getByRole('checkbox', { name: 'Whole Church' })).toBeVisible();

test('Yearly on Attendance opens the graph rather than a page the Admin is refused', async ({
  page,
}) => {
  await admin(page);
  await page.goto('/reports/cells');

  await period(page).getByRole('button', { name: 'Yearly' }).click();

  await expect(page).toHaveURL(/\/trends$/);
  await expect(page.getByText('This page isn’t part of your screens')).toHaveCount(0);
  await graphShown(page);
  await expect(report(page).locator('a[aria-current="page"]')).toHaveText('Attendance');
});

test('Counts has Monthly and Yearly, and each count keeps the graph', async ({ page }) => {
  const asked = await admin(page);
  await page.goto('/reports/number-of-cells');

  await period(page).getByRole('button', { name: 'Yearly' }).click();
  await expect(page).toHaveURL(/\/trends\?figure=CELLS$/);
  await graphShown(page);
  await expect(report(page).locator('a[aria-current="page"]')).toHaveText('Counts');

  await counts(page).getByRole('button', { name: 'Cell Leaders' }).click();
  await expect(page).toHaveURL(/\/trends\?figure=CELL_LEADERS$/);
  await counts(page).getByRole('button', { name: 'People' }).click();
  await expect(page).toHaveURL(/\/trends\?figure=PEOPLE$/);
  await graphShown(page);
  await expect
    .poll(() => asked.map((params) => params.get('figure')))
    .toEqual(expect.arrayContaining(['CELLS', 'CELL_LEADERS', 'PEOPLE']));

  await period(page).getByRole('button', { name: 'Monthly' }).click();
  await expect(page).toHaveURL(/\/reports\/number-of-people$/);
});

test('the tabs without a graph take the Admin to their own page', async ({ page }) => {
  await admin(page);
  await page.goto('/trends?figure=CELLS');

  await expect(report(page).getByRole('link', { name: 'Encounter Readiness' })).toHaveAttribute(
    'href',
    '/reports/suynl',
  );
  await expect(report(page).getByRole('link', { name: 'Training' })).toHaveAttribute(
    'href',
    '/reports/training',
  );
});
