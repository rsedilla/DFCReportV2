import { expect, test, type Page } from '@playwright/test';

import {
  mockAwaitingReassignment,
  mockGrants,
  mockPeople,
  mockPeopleWithoutACell,
  mockSignedIn,
} from './mock-api';
import {
  mockCellMeetings,
  mockCellReport,
  mockCells,
  mockDccEvents,
  mockDccReport,
  mockDccRoster,
  mockMeetingsAwaiting,
  mockPendingDcc,
} from './mock-attendance';

/**
 * Loading batch C (owner, 2026-11-17): a list or a Cell's month stays on screen, faded, while
 * another month of it loads; the People search starts without waiting for the account read; and
 * Record asks for every Sunday's checklist together. Names are invented (`CLAUDE.md`, Secrets).
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

test('Cells keeps the list, faded, under a line naming the month loading', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await mockSignedIn(page);
  await mockCells(page);
  await page.goto('/cells');
  await expect(page.getByText('CELL-000007').filter({ visible: true }).first()).toBeVisible();

  const release = await gate(page, '**/api/v1/cells?*');
  await page.getByRole('button', { name: 'Show May 2026' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Loading May 2026…' })).toBeVisible();
  const kept = page.locator('[aria-busy="true"]').filter({ hasText: 'CELL-000007' });
  await expect(kept).toBeVisible();
  await expect(kept).toHaveClass(/opacity-60/);

  release();
  await expect(page.getByText('Loading May 2026…')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
});

test('a new Cells search is a different list and is not kept', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await mockSignedIn(page);
  await mockCells(page);
  await page.goto('/cells');
  await expect(page.getByText('CELL-000007').filter({ visible: true }).first()).toBeVisible();

  const release = await gate(page, '**/api/v1/cells?*');
  await page.goto('/cells?q=Ramos');

  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByText('CELL-000007').filter({ visible: true })).toHaveCount(0);
  release();
  await expect(page.getByText('CELL-000007').filter({ visible: true }).first()).toBeVisible();
});

test("a Cell's meetings keep the month shown, faded, while another loads", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await mockSignedIn(page);
  await mockCellMeetings(page);
  await page.goto('/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings');
  await expect(page.getByText('3 of 4').first()).toBeVisible();

  const release = await gate(page, '**/api/v1/cells/*/meetings?*');
  await page.getByRole('button', { name: 'Show May 2026' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Loading May 2026…' })).toBeVisible();
  const kept = page.locator('[aria-busy="true"]').filter({ hasText: '3 of 4' });
  await expect(kept).toBeVisible();
  await expect(kept).toHaveClass(/opacity-60/);

  release();
  await expect(page.getByText('Loading May 2026…')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
});

test('the People search starts before the account read answers', async ({ page }) => {
  await mockSignedIn(page);
  await mockPeople(page);
  const release = await gate(page, '**/api/v1/auth/me');

  const searched = page.waitForRequest((request) =>
    /\/api\/v1\/people\?/.test(request.url()),
  );
  await page.goto('/people?q=Ramos');
  await searched;

  release();
});

test("Record asks for every Sunday's checklist together", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await mockSignedIn(page);
  await mockCells(page);
  await mockCellMeetings(page);
  await mockMeetingsAwaiting(page);
  await mockDccEvents(page);
  await mockDccRoster(page);

  // Every checklist is held, so a second one asked for only after the first answered would
  // never arrive.
  const asked = new Set<string>();
  page.on('request', (request) => {
    const match = /\/dcc\/events\/([^/]+)\/roster/.exec(request.url());
    if (match) asked.add(match[1]);
  });
  const release = await gate(page, '**/api/v1/dcc/events/*/roster*');

  await page.goto('/dashboard');
  await expect.poll(() => asked.size).toBeGreaterThanOrEqual(2);

  release();
});

test('Recording Progress keeps the week shown, faded, while another loads', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-08T02:00:00Z'));
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
  await mockGrants(page, ['reports.view_subtree']);
  const column = (recorded: number, owed: number) => ({ recorded, owed });
  await page.route('**/api/v1/reports/recording-status/leader?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        kind: 'WEEK',
        start: '2026-10-05',
        end: '2026-10-11',
        open: true,
        branch: {
          cell: { ...column(1, 2), percent: 50 },
          dcc: { ...column(1, 1), percent: 100 },
        },
        previous: {
          start: '2026-09-28',
          end: '2026-10-04',
          open: true,
          cell: column(2, 2),
          dcc: column(1, 1),
        },
        rows: [
          {
            leader: {
              id: '3f1b7c6e-0000-4000-8000-000000000901',
              member_id: 'M-000201',
              full_name: 'Ana Lim',
            },
            cell: column(1, 2),
            dcc: column(1, 1),
            status: { kind: 'STILL_TO_RECORD', leaders: 1 },
            opens_pending: { cell: true, dcc: true },
          },
        ],
        others: null,
      }),
    }),
  );

  await page.goto('/dashboard');
  await page
    .getByRole('group', { name: 'Outstanding work' })
    .getByRole('button', { name: 'Recording Progress' })
    .click();
  const panel = page.getByRole('region', { name: 'Recording Progress' });
  await expect(panel.getByRole('table', { name: 'My 12' })).toBeVisible();

  const release = await gate(page, '**/api/v1/reports/recording-status/leader?*');
  await panel.getByRole('button', { name: 'The period before' }).click();

  await expect(panel.getByRole('status').filter({ hasText: /^Loading .+…$/ })).toBeVisible();
  const kept = panel.locator('[aria-busy="true"]').filter({ hasText: 'Ana Lim' });
  await expect(kept).toBeVisible();
  await expect(kept).toHaveClass(/opacity-60/);

  release();
  await expect(panel.getByRole('status').filter({ hasText: /^Loading .+…$/ })).toHaveCount(0);
  await expect(panel.locator('[aria-busy="true"]')).toHaveCount(0);
});
