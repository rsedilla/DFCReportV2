import { expect, test } from '@playwright/test';

import { mockSignedIn, mockWholeChurchReader } from './mock-api';
import {
  mockCellReport,
  mockCellReportForOneCell,
  mockCells,
  mockCellsAtScale,
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

test.describe('how these are counted', () => {
  test('each report explains its own counting, in words', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellReport(page);
    await mockDccEvents(page);
    await mockDccReport(page);

    await page.goto('/reports/cells');
    await page.getByRole('button', { name: 'How these are counted' }).click();
    const cells = page.getByRole('dialog', { name: 'How these are counted' });
    await expect(cells.getByText(/^Meetings with a record, out of the meetings/)).toBeVisible();
    await expect(cells.getByText(/^Records filed, out of records owed/)).toHaveCount(0);
    await cells.getByRole('button', { name: 'Close' }).click();
    await expect(cells).toBeHidden();

    await page.goto('/reports/dcc');
    await page.getByRole('button', { name: 'How these are counted' }).click();
    const dcc = page.getByRole('dialog', { name: 'How these are counted' });
    await expect(dcc.getByText(/^Records filed, out of records owed/)).toBeVisible();
    await expect(dcc.getByText(/Cell’s schedule/)).toHaveCount(0);
  });
});

test.describe('the table header', () => {
  // Both halves are needed for the row to stay pinned: sticky cells, and a frame that
  // is not itself a scroll container at this width.
  test('stays pinned to the top of the window on a desktop', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellReport(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/reports/cells');

    const header = page
      .getByRole('region', { name: 'Coverage by Cell' })
      .getByRole('columnheader', { name: 'Cell' });
    await expect(header).toBeVisible();

    expect(await header.evaluate((cell) => getComputedStyle(cell).position)).toBe('sticky');
    expect(
      await header.evaluate(
        (cell) => getComputedStyle(cell.closest('table')!.parentElement!).overflowX,
      ),
    ).toBe('visible');
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
    await expect(table.getByRole('link', { name: 'CELL-000007' }).filter({ visible: true })).toHaveAttribute(
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

  test('the coverage table pages at ten, and a ranked table would not look like this', async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockCellsAtScale(page);
    await mockCellReport(page);
    await page.goto('/reports/cells');

    const table = page.getByRole('region', { name: 'Coverage by Cell' });
    const rows = table.getByRole('link', { name: /^CELL-/ }).filter({ visible: true });

    // Ten of the eleven, in the order the index returned them. The two that have
    // recorded least are CELL-000010 and CELL-000011, so a table ordered worst-first
    // would open with them and this one closes with them (sections 13 and 17).
    await expect(rows).toHaveCount(10);
    await expect(rows.first()).toHaveText('CELL-000001');
    await expect(rows.nth(9)).toHaveText('CELL-000010');
    await expect(table.getByRole('button', { name: 'Previous' })).toHaveCount(0);

    await table.getByRole('button', { name: 'Next' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveText('CELL-000011');

    // No count of the Cells behind, in any phrasing: that figure is one section 20 does
    // not define.
    await expect(table.getByText(/behind/)).toHaveCount(0);
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

test.describe('the year view (decision 0257)', () => {
  /** Owed and Filed differ by month, so a wrong sum cannot pass by coincidence. */
  const FIGURES: Record<string, { owed: number; met: number }> = {
    '2026-01-01': { owed: 10, met: 9 },
    '2026-02-01': { owed: 12, met: 8 },
    '2026-04-01': { owed: 14, met: 14 },
    '2026-05-01': { owed: 16, met: 11 },
    '2026-06-01': { owed: 18, met: 5 },
  };

  test('one row per month begun, and a year row adding up Owed and Filed of the months read', async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await page.route('**/api/v1/reports/dcc/monthly*', (route) => {
      const period = new URL(route.request().url()).searchParams.get('period') ?? '';
      const figures = FIGURES[period];

      // March is refused, as a month outside the reader's reach would be.
      return figures
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              scope: { kind: 'WHOLE_CHURCH' },
              period,
              open: period === '2026-06-01',
              n: 4,
              removed_events: [],
              unique_people: 5,
              classification: { vip: 1, second_timer: 1, third_timer: 1, fourth_timer: 1, regular: 1 },
              buckets: [],
              coverage: figures,
            }),
          })
        : route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'SCOPE_DENIED', message: 'Outside your scope.', details: {} },
            }),
          });
    });

    await page.goto('/reports/dcc?period=year');

    await expect(page.getByRole('heading', { name: 'Month by month, January to June 2026' })).toBeVisible();

    const table = page.getByRole('table');
    const rows = table.getByRole('row');
    // A header, six months and the year row: July has not begun and is not shown.
    await expect(rows).toHaveCount(8);
    await expect(table.getByRole('row', { name: /^July/ })).toHaveCount(0);

    // March could not be read: no figures on its row, and it is left out of the year row.
    const march = table.getByRole('row', { name: /^March/ });
    await expect(march.getByRole('cell')).toHaveCount(2);
    await expect(march).toContainText('Outside your scope.');
    await expect(page.getByText('One month could not be read and is not in the year row.')).toBeVisible();

    const year = table.getByRole('row', { name: /^Year so far/ });
    const cells = year.getByRole('cell');
    await expect(cells.nth(1)).toHaveText('70');
    await expect(cells.nth(2)).toHaveText('47');
    // No people count for the year: a person who came in two months is one person.
    await expect(cells.nth(3)).toHaveText('');
    // Section 17: the year row includes a month still open, and says which.
    await expect(cells.nth(4)).toHaveText('Includes June, still open');
  });
});
