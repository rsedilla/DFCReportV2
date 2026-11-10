import { expect, test, type Page } from '@playwright/test';

import { PERSON_IN_SCOPE, mockPeople, mockSignedIn } from './mock-api';
import {
  mockCellMeetings,
  mockCellReport,
  mockCells,
  mockDccEvents,
  mockDccOwed,
  mockDccReport,
  mockDccRoster,
  mockDccTwelve,
  mockMeetingsAwaiting,
  mockPendingDcc,
} from './mock-attendance';

/**
 * What a screen shows while it waits (owner, 2026-11-06): a report keeps its figures, faded,
 * while another period loads; the tab bar and the sidebar hold grey places until the account is
 * known; a person's page shows grey blocks in its own shape. Each says "Loading" to a screen
 * reader as before.
 */

const NOW = new Date('2026-06-20T02:00:00Z');

/** Holds every request matching `pattern` until the returned function is called. */
async function gate(page: Page, pattern: string | RegExp): Promise<() => void> {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  await page.route(pattern, async (route) => {
    await opened;
    await route.fallback();
  });
  return open;
}

async function dccReportForMay(page: Page) {
  await page.clock.setFixedTime(NOW);
  await mockSignedIn(page);
  await mockDccEvents(page);
  await mockDccReport(page);
  await mockDccTwelve(page, { today: '2026-06-20' });
  await page.goto('/reports/dcc?month=2026-05-01');
  await expect(page.getByText('Consuelo Bautista').first()).toBeVisible();
}

test("stepping a report's month keeps the figures, faded, under a line naming the month loading", async ({
  page,
}) => {
  await dccReportForMay(page);
  const release = await gate(page, '**/api/v1/**');

  await page.getByRole('button', { name: 'The period before' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Loading April 2026…' })).toBeVisible();
  const kept = page.locator('[aria-busy="true"]').filter({ hasText: 'Consuelo Bautista' });
  await expect(kept).toBeVisible();
  await expect(kept).toHaveClass(/opacity-60/);
  await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0);

  release();
  await expect(page.getByText('Loading April 2026…')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
});

test('a month that fails to load shows its failure, not the kept figures', async ({ page }) => {
  await dccReportForMay(page);
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  await page.route(/\/api\/v1\/reports\/dcc\/twelve\?.*start=2026-04-01/, async (route) => {
    await opened;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong.', details: {} } }),
    });
  });

  await page.getByRole('button', { name: 'The period before' }).click();
  await expect(page.getByText('Loading April 2026…')).toBeVisible();
  open();

  await expect(page.getByRole('alert').filter({ hasText: /\S/ }).first()).toBeVisible();
  await expect(page.getByText('Consuelo Bautista')).toHaveCount(0);
  await expect(page.getByText('Loading April 2026…')).toHaveCount(0);
});

for (const [width, where] of [
  [390, 'tab bar'],
  [1280, 'sidebar'],
] as const) {
  test(`the ${where} holds grey places until the account is known`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockSignedIn(page);
    const release = await gate(page, '**/api/v1/auth/me');
    await page.goto('/dashboard');

    const navigation = page.getByRole('navigation', { name: 'Main' });
    await expect(navigation.locator('[data-nav-placeholder]')).toHaveCount(5);
    await expect(navigation.getByRole('link')).toHaveCount(0);

    release();
    await expect(navigation.getByRole('link').first()).toBeVisible();
    await expect(navigation.locator('[data-nav-placeholder]')).toHaveCount(0);
  });
}

test("a person's page shows grey blocks in its shape while it loads, and says Loading", async ({ page }) => {
  await mockSignedIn(page);
  await mockPeople(page);
  const release = await gate(page, new RegExp(`/api/v1/people/${PERSON_IN_SCOPE.id}$`));
  await page.goto(`/people/${PERSON_IN_SCOPE.id}`);

  await expect(page.locator('[data-loading-blocks]')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Loading…' })).toHaveCount(1);
  await expect(page.locator('[data-loading-blocks]')).toHaveAttribute('aria-hidden', 'true');

  release();
  await expect(page.getByText('DCC stage', { exact: true })).toBeVisible();
  await expect(page.locator('[data-loading-blocks]')).toHaveCount(0);
});

test('a list that has not answered shows grey rows, and says Loading to a screen reader', async ({
  page,
}) => {
  await page.clock.setFixedTime(NOW);
  await mockSignedIn(page);
  await mockCells(page);
  await mockCellMeetings(page);
  await mockDccEvents(page);
  await mockCellReport(page);
  await mockDccReport(page);
  await mockDccRoster(page);
  await mockDccOwed(page);
  await mockPendingDcc(page);
  await mockMeetingsAwaiting(page);
  const release = await gate(page, '**/api/v1/cells/meetings/awaiting?*');

  await page.goto('/dashboard');

  const rows = page.locator('main [data-loading-row]');
  await expect(rows).toHaveCount(6);
  await expect(page.locator('main').getByRole('status').filter({ hasText: 'Loading\u2026' })).toHaveCount(1);

  release();
  await expect(rows).toHaveCount(0);
});

test('a People search that has not answered shows grey rows', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await mockSignedIn(page);
  await mockPeople(page);
  await page.goto('/people');
  const release = await gate(page, '**/api/v1/people?*');

  await page.getByLabel(/search by name/i).fill('Rosa');
  await page.keyboard.press('Enter');

  const rows = page.locator('main [data-loading-row]');
  await expect(rows).toHaveCount(6);

  release();
  await expect(rows).toHaveCount(0);
});
