import { expect, test } from '@playwright/test';

import { mockSignedIn, mockWholeChurchReader } from './mock-api';
import {
  mockCellReport,
  mockCellReportForOneCell,
  mockCells,
  mockDccEvents,
  mockDccReport,
} from './mock-attendance';

/**
 * What the Reports screens do, as opposed to what they look like (UI-6a).
 *
 * `accessibility.spec.ts` scans the two reports for conformance, and cannot tell whether
 * the switch keeps the month, whether a typed month is refused, or whether a list's Total
 * is the sum of its rows. These cases pin that behaviour.
 */

/** 10:00 on 20 June 2026 in Manila, so June is the current month and July has not begun. */
const NOW = new Date('2026-06-20T02:00:00Z');

test.describe('the Reports switch', () => {
  test('marks the report on screen and carries the month to the other', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockDccReport(page);

    const periods: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/reports/dcc/monthly')) {
        periods.push(new URL(request.url()).searchParams.get('period') ?? '');
      }
    });

    await page.goto('/reports/dcc?month=2026-05-01');

    const which = page.getByRole('list', { name: 'Which report' });
    await expect(which.getByRole('link', { name: 'DCC' })).toHaveAttribute('aria-current', 'page');
    await expect(which.getByRole('link', { name: 'Cells' })).not.toHaveAttribute('aria-current');
    await expect(which.getByRole('link', { name: 'Cells' })).toHaveAttribute(
      'href',
      '/reports/cells?month=2026-05-01',
    );
    await expect(page.getByText('May 2026', { exact: true })).toBeVisible();
    await expect.poll(() => periods).toContain('2026-05-01');
  });

  test('a month in the address that is not a month, or has not begun, opens the current one', async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockDccReport(page);

    const periods: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/reports/dcc/monthly')) {
        periods.push(new URL(request.url()).searchParams.get('period') ?? '');
      }
    });

    await page.goto('/reports/dcc?month=2026-07-01');
    await expect(page.getByText('June 2026', { exact: true })).toBeVisible();

    await page.goto('/reports/dcc?month=next-month');
    await expect(page.getByText('June 2026', { exact: true })).toBeVisible();

    await expect.poll(() => periods.length).toBeGreaterThan(0);
    expect(periods.every((period) => period === '2026-06-01')).toBe(true);
  });
});

test.describe('the report figures', () => {
  test('each list closes with a Total that is the sum of its rows', async ({ page }) => {
    await mockSignedIn(page);
    await mockDccReport(page);
    await page.goto('/reports/dcc');

    // The fixture: classification 1 + 2 + 1 + 1 + 2, buckets 2 + 3 + 2, seven people each.
    const journey = page.getByRole('region', { name: 'Where people are in their journey' });
    await expect(journey.getByRole('term').last()).toHaveText('Total');
    await expect(journey.getByRole('definition').last()).toHaveText('7');

    const often = page.getByRole('region', { name: 'How often people came' });
    await expect(often.getByRole('term').last()).toHaveText('Total');
    await expect(often.getByRole('definition').last()).toHaveText('7');
    await expect(often.getByRole('term').filter({ hasText: '3 times — all of them' })).toBeVisible();
  });

  test('a single Cell shows how often people came, with its own Total', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellReportForOneCell(page);
    await page.goto('/reports/cells');

    await page.getByLabel('Figures for').selectOption('3f1b7c6e-0000-4000-8000-000000000101');

    // The fixture: buckets 1 + 2 + 1, four people.
    const often = page.getByRole('region', { name: 'How often people came' });
    await expect(often.getByRole('definition').last()).toHaveText('4');
  });
});

test.describe('the coverage tables', () => {
  test('Coverage by Cell lists each Cell with its figure, and leaves once one Cell is chosen', async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellReport(page);
    await page.goto('/reports/cells');

    const table = page.getByRole('region', { name: 'Coverage by Cell' });
    // Table from `lg`, cards below it: whichever this viewport shows.
    await expect(table.getByRole('link', { name: 'C-0007' }).filter({ visible: true })).toHaveAttribute(
      'href',
      '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings?month=2026-06-01',
    );
    await expect(table.getByText('3 of 4 meetings recorded').filter({ visible: true })).toBeVisible();
    // Decision 0225: the Cell that scheduled nothing is shown, not dropped.
    await expect(table.getByText('0 of 0 meetings recorded').filter({ visible: true })).toBeVisible();
    await expect(table.getByText('Total')).toHaveCount(0);

    await page.getByLabel('Figures for').selectOption('3f1b7c6e-0000-4000-8000-000000000101');
    await expect(page.getByRole('region', { name: 'Coverage by Cell' })).toHaveCount(0);
  });

  test('Coverage by Sunday keeps a removed Sunday in its place, and leaves for a Network', async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockWholeChurchReader(page);
    await mockDccEvents(page);
    await mockDccReport(page);
    await page.goto('/reports/dcc');

    const table = page.getByRole('region', { name: 'Coverage by Sunday' });
    const visible = (text: string) => table.getByText(text).filter({ visible: true });

    await expect(table.getByRole('link', { name: /June/ }).filter({ visible: true })).toHaveCount(4);
    await expect(visible('5 of 8 records filed')).toBeVisible();
    await expect(visible('No records owed — no service')).toBeVisible();
    await expect(visible('No service was held. The church held a combined regional service.')).toBeVisible();
    await expect(visible('Not counted this month.')).toBeVisible();
    await expect(visible('No records owed yet')).toBeVisible();
    // Only the Sunday with records still owed links to who has to record.
    await expect(
      table.getByRole('link', { name: 'See who still has to record' }).filter({ visible: true }),
    ).toHaveAttribute('href', '/dcc/3f1b7c6e-0000-4000-8000-000000000501/gaps');

    await page.getByLabel('Figures for').selectOption('MENS');
    await expect(page.getByRole('region', { name: 'Coverage by Sunday' })).toHaveCount(0);
  });
});
