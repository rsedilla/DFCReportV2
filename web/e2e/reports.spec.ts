import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn, mockWholeChurchReader } from './mock-api';
import {
  mockCellReport,
  mockCellReportForOneCell,
  mockCellTwelve,
  mockCells,
  mockCellsAtScale,
  mockCoverageByLeader,
  mockDccEvents,
  mockDccReport,
} from './mock-attendance';
import {
  CONQUEST_COUNTS,
  SUYNL_COUNTS,
  TRAINING_COUNTS,
  mockConquest,
  mockSuynl,
  mockTraining,
} from './mock-growth';

/**
 * What the Reports screens do, as opposed to what they look like (UI-6a).
 *
 * `accessibility.spec.ts` scans the reports for conformance, and cannot tell whether the
 * tabs keep the month, whether a typed month is refused, whether a list's Total is the sum
 * of its rows, or whether a Growth report offers a way to change what it counts. These
 * cases pin that behaviour.
 */

/** 10:00 on 20 June 2026 in Manila, so June is the current month and July has not begun. */
const NOW = new Date('2026-06-20T02:00:00Z');

/** A leader opened from the By leader table: Consuelo Bautista in `mockCoverageByLeader`. */
const LEADER = '3f1b7c6e-0000-4000-8000-000000000701';

/** A Growth report's cards, in order, each with its figure. */
async function expectCards(page: Page, cards: [string, number][]) {
  const list = page.locator('main dl');
  await expect(list.getByRole('term')).toHaveText(cards.map(([label]) => label));
  await expect(list.getByRole('definition')).toHaveText(cards.map(([, count]) => String(count)));
}

/**
 * Nothing under Reports files or changes a record (SKILL.md section 19; decision 0292): no
 * box, no field and no button. The Growth tab's cards are filters; here they are figures.
 */
async function expectReadOnly(page: Page) {
  const main = page.locator('main');
  await expect(main.getByRole('checkbox')).toHaveCount(0);
  await expect(main.getByRole('button')).toHaveCount(0);
  await expect(main.locator('input, select, textarea')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
}

/** The six tabs, in order, and the address each opens (SKILL.md section 19; decision 0292). */
const TABS = [
  { label: 'Cell Groups', path: '/reports/cells', dated: true },
  { label: 'DCC', path: '/reports/dcc', dated: true },
  { label: 'SUYNL', path: '/reports/suynl', dated: false },
  { label: 'Training', path: '/reports/training', dated: false },
  { label: 'Conquest', path: '/reports/conquest', dated: false },
  { label: 'Filed reports', path: '/reports/filed', dated: true },
] as const;

/** Every read the six reports make, answered, so any of them can be opened. */
async function mockEveryReport(page: Page) {
  await mockSignedIn(page);
  await mockCells(page);
  await mockCellReport(page);
  await mockCellTwelve(page, { today: '2026-06-20' });
  await mockDccEvents(page);
  await mockDccReport(page);
  await mockCoverageByLeader(page);
  await mockSuynl(page);
  await mockTraining(page);
  await mockConquest(page);
}

test.describe('the Reports tabs (decision 0292)', () => {
  for (const tab of TABS) {
    test(`${tab.label} carries all six tabs and is the one marked current`, async ({ page }) => {
      await page.clock.setFixedTime(NOW);
      await mockEveryReport(page);
      await page.goto(tab.path);

      await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
      const which = page.getByRole('navigation', { name: 'Which report' });
      await expect(which.getByRole('link')).toHaveText(TABS.map((each) => each.label));

      const current = which.locator('a[aria-current="page"]');
      await expect(current, 'exactly one report is marked as the current page').toHaveCount(1);
      await expect(current).toHaveText(tab.label);

      // The old two-link switch is gone rather than kept beside the tabs.
      await expect(page.getByRole('list', { name: 'Which report' })).toHaveCount(0);
    });
  }

  test('the month travels to Cell Groups, DCC and Filed reports, and never to the Growth three', async ({
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

    await page.goto('/reports/dcc?month=2026-05-01');

    const which = page.getByRole('navigation', { name: 'Which report' });
    for (const tab of TABS) {
      await expect(which.getByRole('link', { name: tab.label, exact: true })).toHaveAttribute(
        'href',
        tab.dated ? `${tab.path}?month=2026-05-01` : tab.path,
      );
    }
    await expect(page.getByText('May 2026', { exact: true })).toBeVisible();
    await expect.poll(() => periods).toContain('2026-05-01');
  });

  test('following Filed reports from a past month opens that month there', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellReport(page);

    const periods: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/reports/cells/monthly')) {
        periods.push(new URL(request.url()).searchParams.get('period') ?? '');
      }
    });

    await page.goto('/reports/cells?month=2026-05-01');
    await page
      .getByRole('navigation', { name: 'Which report' })
      .getByRole('link', { name: 'Filed reports', exact: true })
      .click();

    await expect(page).toHaveURL(/\/reports\/filed\?month=2026-05-01$/);
    await expect(page.getByText('May 2026', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Which report' }).locator('a[aria-current="page"]'),
    ).toHaveText('Filed reports');
    await expect.poll(() => periods).toContain('2026-05-01');
    expect(periods.every((period) => period === '2026-05-01')).toBe(true);
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

test.describe('the browser Back button', () => {
  test('steps back through the month, the period and the Network, and a reload keeps them', async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockWholeChurchReader(page);
    await mockDccReport(page);
    await page.goto('/reports/dcc');

    await expect(page.getByText('June 2026', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Show May 2026' }).click();
    await expect(page.getByText('May 2026', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show April 2026' }).click();
    await expect(page.getByText('April 2026', { exact: true })).toBeVisible();

    // The month is in the address, so a reload opens the same figures.
    await page.reload();
    await expect(page.getByText('April 2026', { exact: true })).toBeVisible();

    await page.getByLabel('Figures for').selectOption('MENS');
    await expect(page).toHaveURL(/network=MENS/);

    await page.getByRole('radiogroup', { name: 'Report period' }).getByText('Year').click();
    await expect(page).toHaveURL(/period=year/);

    // Back through each change, in the order they were made.
    await page.goBack();
    await expect(page).not.toHaveURL(/period=year/);
    await expect(page).toHaveURL(/network=MENS/);

    await page.goBack();
    await expect(page).not.toHaveURL(/network=MENS/);
    await expect(page.getByText('April 2026', { exact: true })).toBeVisible();

    await page.goBack();
    await expect(page.getByText('May 2026', { exact: true })).toBeVisible();

    await page.goBack();
    await expect(page.getByText('June 2026', { exact: true })).toBeVisible();
  });

  test('steps back through the leader chosen in Figures for on Cell Groups (decision 0293)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockCellTwelve(page, { today: '2026-06-20' });
    await page.goto('/reports/cells');

    await page.getByLabel('Figures for').selectOption(LEADER);
    await expect(page).toHaveURL(new RegExp(`leader=${LEADER}`));

    await page.goBack();
    await expect(page).not.toHaveURL(/leader=/);
    await expect(page.getByLabel('Figures for')).toHaveValue('');
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
    await page.goto('/reports/filed');

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

test.describe('the coverage tables, under Filed reports (decision 0292)', () => {
  test('Coverage by Cell lists each Cell with its figure, and no total', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellReport(page);
    await page.goto('/reports/filed');

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
  });

  test('the coverage table pages at ten, and a ranked table would not look like this', async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockCellsAtScale(page);
    await mockCellReport(page);
    await page.goto('/reports/filed');

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

    // The count of Cells behind is over every page and by decision 0267's predicate — two
    // of the eleven have a meeting that came with no record — and it is in words beside
    // its complement, never a share.
    await expect(table.getByText('2 behind · 9 not behind')).toBeVisible();
  });

  test('the behind filter keeps the Cells a meeting that came is missing from, in their order', async ({
    page,
  }) => {
    // Decision 0267: behind is meetings due so far minus meetings recorded. The filter was
    // built and removed on 2026-09-20 because it compared with the whole month's schedule,
    // which counts meetings that have not happened (decision 0239).
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockCellsAtScale(page);
    await mockCellReport(page);
    await page.goto('/reports/filed');

    const table = page.getByRole('region', { name: 'Coverage by Cell' });
    const behind = table.getByRole('button', { name: 'Show only Cells behind' });
    await expect(behind).toHaveAttribute('aria-pressed', 'false');
    await behind.click();

    const rows = table.getByRole('link', { name: /^CELL-/ }).filter({ visible: true });
    await expect(rows).toHaveText(['CELL-000010', 'CELL-000011']);
    await expect(behind).toHaveAttribute('aria-pressed', 'true');
    const grid = table.getByRole('table', { name: 'Recording coverage for each Cell' });
    await expect(grid.getByRole('row', { name: /CELL-000010/ })).toContainText('3 behind');
    await expect(grid.getByRole('row', { name: /CELL-000011/ })).toContainText('4 behind');
  });

  test('?behind=1, the Record screen’s link, opens By Cell already filtered to the Cells behind', async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockCellsAtScale(page);
    await mockCellReport(page);
    await page.goto('/reports/filed?month=2026-06-01&behind=1');

    await expect(page.getByRole('radio', { name: 'By Cell' })).toBeChecked();
    const table = page.getByRole('region', { name: 'Coverage by Cell' });
    await expect(table.getByRole('button', { name: 'Show only Cells behind' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(table.getByRole('link', { name: /^CELL-/ }).filter({ visible: true })).toHaveText([
      'CELL-000010',
      'CELL-000011',
    ]);
  });

  test('Coverage by Sunday keeps a removed Sunday in its place', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockWholeChurchReader(page);
    await mockDccEvents(page);
    await mockDccReport(page);
    await page.goto('/reports/filed?kind=dcc');

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
  });
});

test.describe('Cell Groups and DCC keep coverage first, and send the rows to Filed reports', () => {
  test('Cell Groups opens on recording coverage as one line, with no row-by-row table of its own', async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockCellTwelve(page, { today: '2026-06-20' });
    await page.goto('/reports/cells?month=2026-05-01');

    await expect(page.getByText('Who came to a Cell, and where they are in their journey.')).toBeVisible();
    // Section 12 and decision 0202: coverage is the first figure, before anybody is counted,
    // and decision 0293 makes it one line above My 12.
    const coverage = page.getByText('6 of 8 meetings recorded in the month');
    await expect(coverage).toBeVisible();
    const twelve = page.getByRole('heading', { name: /^My 12 · / });
    await expect(twelve).toBeVisible();
    const [line, heading] = await Promise.all([coverage.boundingBox(), twelve.boundingBox()]);
    expect(line!.y, 'the coverage line sits above My 12').toBeLessThan(heading!.y);

    await expect(page.getByRole('heading', { name: 'Recording coverage' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Row by row' })).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Group coverage by' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Coverage by Cell' })).toHaveCount(0);

    await expect(page.getByRole('link', { name: 'see Filed reports' })).toHaveAttribute(
      'href',
      '/reports/filed?month=2026-05-01',
    );
  });

  test('DCC opens on recording coverage, with no row-by-row table of its own', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockDccEvents(page);
    await mockDccReport(page);
    await page.goto('/reports/dcc?month=2026-05-01');

    await expect(
      page.getByText('What the people you oversee recorded for this month’s Sundays.'),
    ).toBeVisible();
    await expect(page.locator('main h2').filter({ visible: true }).first()).toHaveText('Recording coverage');
    await expect(page.getByText('12 of 18 records filed')).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Row by row' })).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Group coverage by' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Coverage by Sunday' })).toHaveCount(0);

    await expect(
      page.getByRole('link', { name: 'By Sunday and by leader, row by row, under Filed reports' }),
    ).toHaveAttribute('href', '/reports/filed?month=2026-05-01&kind=dcc');
  });

  test('a leader opened from By leader carries into Filed reports, By leader', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockCellTwelve(page, { today: '2026-06-20' });
    await mockDccReport(page);
    await mockCoverageByLeader(page);

    await page.goto(`/reports/cells?month=2026-06-01&leader=${LEADER}`);
    await expect(page.getByRole('link', { name: 'see Filed reports' })).toHaveAttribute(
      'href',
      `/reports/filed?month=2026-06-01&leader=${LEADER}&by=leader`,
    );

    await page.goto(`/reports/dcc?month=2026-06-01&leader=${LEADER}`);
    await expect(
      page.getByRole('link', { name: 'By Sunday and by leader, row by row, under Filed reports' }),
    ).toHaveAttribute('href', `/reports/filed?month=2026-06-01&kind=dcc&leader=${LEADER}&by=leader`);
  });
});

test.describe('Filed reports (decision 0292)', () => {
  test('switches between Cell Groups and DCC, each with its own coverage figure', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellReport(page);
    await mockDccEvents(page);
    await mockDccReport(page);

    const asked: string[] = [];
    page.on('request', (request) => {
      const match = /\/api\/v1\/reports\/(cells|dcc)\/monthly\?/.exec(request.url());
      if (match) {
        asked.push(match[1]);
      }
    });

    await page.goto('/reports/filed?month=2026-06-01');
    await expect(page.getByText('What has been filed, and by whom.')).toBeVisible();

    const which = page.getByRole('group', { name: 'Which records' });
    await expect(which.getByRole('button')).toHaveText(['Cell Groups', 'DCC']);
    await expect(which.getByRole('button', { name: 'Cell Groups' })).toHaveAttribute('aria-pressed', 'true');
    await expect(which.getByRole('button', { name: 'DCC' })).toHaveAttribute('aria-pressed', 'false');

    // Coverage first here too, and the rows beneath it.
    await expect(page.locator('main h2').filter({ visible: true }).first()).toHaveText('Recording coverage');
    await expect(page.getByText('6 of 8 meetings recorded')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'By Cell' })).toBeChecked();
    await expect(page.getByRole('region', { name: 'Coverage by Cell' })).toBeVisible();
    await expect.poll(() => asked).toContain('cells');
    expect(asked).not.toContain('dcc');

    await which.getByRole('button', { name: 'DCC' }).click();
    await expect(page).toHaveURL(/[?&]kind=dcc/);
    await expect(page).toHaveURL(/[?&]month=2026-06-01/);
    await expect(which.getByRole('button', { name: 'DCC' })).toHaveAttribute('aria-pressed', 'true');
    await expect(which.getByRole('button', { name: 'Cell Groups' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('12 of 18 records filed')).toBeVisible();
    await expect(page.getByText('6 of 8 meetings recorded')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'By Sunday' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'By Cell' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Coverage by Sunday' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Coverage by Cell' })).toHaveCount(0);
    await expect.poll(() => asked).toContain('dcc');

    // Back returns to Cell Groups, because the choice is in the address.
    await page.goBack();
    await expect(page).not.toHaveURL(/kind=dcc/);
    await expect(which.getByRole('button', { name: 'Cell Groups' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('By Cell or By Sunday against By leader, kept in the address', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellReport(page);
    await mockDccEvents(page);
    await mockDccReport(page);
    await mockCoverageByLeader(page);

    const byLeader: string[] = [];
    page.on('request', (request) => {
      const match = /\/api\/v1\/reports\/(cells|dcc)\/monthly\/by-leader/.exec(request.url());
      if (match) {
        byLeader.push(match[1]);
      }
    });

    await page.goto('/reports/filed?month=2026-06-01');
    const by = page.getByRole('radiogroup', { name: 'Group coverage by' });
    await expect(by.getByRole('radio')).toHaveCount(2);
    await expect(by.getByRole('radio', { name: 'By Cell' })).toBeChecked();

    await by.getByText('By leader', { exact: true }).click();
    await expect(page).toHaveURL(/[?&]by=leader/);
    await expect(by.getByRole('radio', { name: 'By leader' })).toBeChecked();
    await expect(page.getByRole('region', { name: 'Coverage by Cell' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Consuelo Bautista' })).toBeVisible();
    await expect(page.getByText('Report coverage')).toBeVisible();
    await expect.poll(() => byLeader).toContain('cells');

    // The choice survives the switch to DCC, and the table asks the DCC figures.
    await page.getByRole('group', { name: 'Which records' }).getByRole('button', { name: 'DCC' }).click();
    await expect(page).toHaveURL(/[?&]kind=dcc/);
    await expect(by.getByRole('radio', { name: 'By leader' })).toBeChecked();
    await expect(by.getByRole('radio', { name: 'By Sunday' })).not.toBeChecked();
    await expect.poll(() => byLeader).toContain('dcc');

    await by.getByText('By Sunday', { exact: true }).click();
    await expect(page).not.toHaveURL(/by=leader/);
    await expect(page.getByRole('region', { name: 'Coverage by Sunday' })).toBeVisible();

    // A reload opens what was chosen.
    await page.goto('/reports/filed?month=2026-06-01&kind=dcc&by=leader');
    await expect(by.getByRole('radio', { name: 'By leader' })).toBeChecked();
  });

  test('one leader opened from By leader offers no By Cell or By Sunday, and returns to your report', async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellReport(page);
    await mockDccEvents(page);
    await mockDccReport(page);
    await mockCoverageByLeader(page);

    const scopes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/monthly/by-leader')) {
        scopes.push(new URL(request.url()).search);
      }
    });

    for (const kind of ['cells', 'dcc'] as const) {
      await page.goto(
        `/reports/filed?month=2026-06-01${kind === 'dcc' ? '&kind=dcc' : ''}&leader=${LEADER}&by=leader`,
      );

      await expect(page.getByRole('link', { name: 'Back to your report' })).toHaveAttribute(
        'href',
        `/reports/${kind}?month=2026-06-01`,
      );
      // By Cell and By Sunday list the reader's own Cells and calendar, so they are not
      // offered once the scope is somebody else's.
      await expect(page.getByText('Report coverage')).toBeVisible();
      await expect(page.getByRole('radio', { name: 'By Cell' })).toHaveCount(0);
      await expect(page.getByRole('radio', { name: 'By Sunday' })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Coverage by Cell' })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Coverage by Sunday' })).toHaveCount(0);
    }

    // Without `by=leader` in the address a leader still opens By leader.
    await page.goto(`/reports/filed?month=2026-06-01&leader=${LEADER}`);
    await expect(page.getByText('Report coverage')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Coverage by Cell' })).toHaveCount(0);

    await expect.poll(() => scopes.length).toBeGreaterThan(0);
    expect(scopes.every((search) => search.includes(LEADER))).toBe(true);
  });
});

test.describe('Filed reports keeps the narrower scope its report had', () => {
  /** Every monthly and by-leader request's scope, as `<report> <query>` without the period. */
  function recordScopes(page: Page): string[] {
    const scopes: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      const match = /^\/api\/v1\/reports\/(cells|dcc)\/monthly(\/by-leader)?$/.exec(url.pathname);
      if (match) {
        const params = new URLSearchParams(url.search);
        params.delete('period');
        params.delete('limit');
        params.delete('cursor');
        scopes.push(`${match[1]}${match[2] ?? ''} ${params.toString()}`);
      }
    });
    return scopes;
  }

  const CELL = '3f1b7c6e-0000-4000-8000-000000000101';

  /**
   * **Cell Groups no longer offers a Cell** (decision 0293 took the Cell choices out of its
   * Figures for), so this state is reached by its address alone. The sentence it shows still
   * no longer says the Cell was "chosen on Cell Groups", which nothing there can now do.
   */
  test('one Cell in the address stays chosen, and only By leader is offered', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellReportForOneCell(page);
    await mockDccEvents(page);
    await mockDccReport(page);
    await mockCoverageByLeader(page);
    const scopes = recordScopes(page);

    await page.goto(`/reports/filed?month=2026-06-01&cell=${CELL}`);

    await expect(page).toHaveURL(/\/reports\/filed\?/);
    await expect(page.getByText(/^Figures for one Cell/)).toBeVisible();
    // The one-Cell fixture's own figure, not the reader's whole branch.
    await expect(page.getByText('3 of 4 meetings recorded')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Group coverage by' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Coverage by Cell' })).toHaveCount(0);
    await expect(page.getByText('Report coverage')).toBeVisible();
    await expect.poll(() => scopes).toContain(`cells scope=CELL&cell_id=${CELL}`);
    await expect.poll(() => scopes).toContain(`cells/by-leader scope=CELL&cell_id=${CELL}`);

    // DCC has no Cell scope, so switching drops it and the reader's own figures return.
    await page.getByRole('group', { name: 'Which records' }).getByRole('button', { name: 'DCC' }).click();
    await expect(page).toHaveURL(/[?&]kind=dcc/);
    await expect(page).not.toHaveURL(/[?&]cell=/);
    await expect(page.getByText(/^Figures for one Cell/)).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'By Sunday' })).toBeChecked();
    await expect(page.getByText('12 of 18 records filed')).toBeVisible();
    expect(scopes.filter((scope) => scope.startsWith('dcc')).every((scope) => !scope.includes('cell_id'))).toBe(
      true,
    );
  });

  test('a Network chosen on DCC stays chosen, and only By leader is offered', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockWholeChurchReader(page);
    await mockCells(page);
    await mockCellReport(page);
    await mockDccEvents(page);
    await mockDccReport(page);
    await mockCoverageByLeader(page);
    const scopes = recordScopes(page);

    await page.goto('/reports/dcc');
    await page.getByLabel('Figures for').selectOption('MENS');
    const link = page.getByRole('link', {
      name: 'By Sunday and by leader, row by row, under Filed reports',
    });
    await expect(link).toHaveAttribute('href', '/reports/filed?month=2026-06-01&kind=dcc&network=MENS');
    await link.click();

    await expect(page).toHaveURL(/\/reports\/filed\?/);
    await expect(page.getByText('Figures for the Men’s Network.')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Group coverage by' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Coverage by Sunday' })).toHaveCount(0);
    await expect(page.getByText('Report coverage')).toBeVisible();
    await expect.poll(() => scopes).toContain('dcc scope=NETWORK&network=MENS');
    await expect.poll(() => scopes).toContain('dcc/by-leader scope=NETWORK&network=MENS');

    // Cell Groups has no Network scope, so switching drops it.
    await page
      .getByRole('group', { name: 'Which records' })
      .getByRole('button', { name: 'Cell Groups' })
      .click();
    await expect(page).not.toHaveURL(/[?&]network=/);
    await expect(page.getByText('Figures for the Men’s Network.')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'By Cell' })).toBeChecked();
    await expect.poll(() => scopes).toContain('cells scope=WHOLE_CHURCH');
  });

  test('a Cell in the address is ignored for DCC, and a Network for Cell Groups', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockWholeChurchReader(page);
    await mockCells(page);
    await mockCellReport(page);
    await mockDccEvents(page);
    await mockDccReport(page);
    const scopes = recordScopes(page);

    await page.goto(`/reports/filed?month=2026-06-01&kind=dcc&cell=${CELL}`);
    await expect(page.getByRole('radio', { name: 'By Sunday' })).toBeChecked();
    await expect(page.getByText(/^Figures for one Cell/)).toHaveCount(0);
    await expect.poll(() => scopes).toContain('dcc scope=WHOLE_CHURCH');

    await page.goto('/reports/filed?month=2026-06-01&network=MENS');
    await expect(page.getByRole('radio', { name: 'By Cell' })).toBeChecked();
    await expect(page.getByText('Figures for the Men’s Network.')).toHaveCount(0);
    await expect.poll(() => scopes).toContain('cells scope=WHOLE_CHURCH');
    expect(scopes.some((scope) => scope.includes('NETWORK') || scope.includes('CELL'))).toBe(false);
  });

  test('a Network in the address does not narrow, or claim to narrow, a reader without a whole-church grant', async ({
    page,
  }) => {
    // Only a whole-church reader is offered a Network on DCC, so for anybody else the
    // figures stay their own branch, and a line naming a Network would misstate their scope
    // (sections 17 and 19: a figure says what it counts).
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockDccEvents(page);
    await mockDccReport(page);
    const scopes = recordScopes(page);

    await page.goto('/reports/filed?month=2026-06-01&kind=dcc&network=MENS');
    await expect(page.getByText('12 of 18 records filed')).toBeVisible();
    await expect.poll(() => scopes.length).toBeGreaterThan(0);
    expect(scopes.some((scope) => scope.includes('NETWORK'))).toBe(false);
    await expect(page.getByText('Figures for the Men’s Network.')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'By Sunday' })).toBeChecked();
  });
});

test.describe('the Growth reports: counts only, as of now (decision 0292)', () => {
  for (const report of [
    { path: '/reports/suynl', counts: '**/api/v1/suynl/counts' },
    { path: '/reports/training', counts: '**/api/v1/training/counts' },
    { path: '/reports/conquest', counts: '**/api/v1/conquest/counts' },
  ]) {
    test(`${report.path} says so when its counts cannot be read, rather than showing figures`, async ({
      page,
    }) => {
      await mockSignedIn(page);
      await page.route(report.counts, (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'CAPABILITY_DENIED', message: 'You cannot view these counts.', details: {} },
          }),
        }),
      );
      await page.goto(report.path);

      await expect(page.locator('main').getByRole('alert')).toContainText('You cannot view these counts.');
      // No figure is invented in its place.
      const figures = page.locator('main dl').getByRole('definition');
      await expect(figures.first()).toBeVisible();
      for (const text of await figures.allTextContents()) {
        expect(text).toBe('–');
      }
      await expect(page.getByText(/for the \d+ (person|people) in your care/)).toHaveCount(0);
    });
  }

  test('SUYNL shows its three counts, read only, and sends ticking to Growth', async ({ page }) => {
    await mockSignedIn(page);
    await mockSuynl(page);
    await page.goto('/reports/suynl');

    await expect(
      page.getByText(`SUYNL for the ${SUYNL_COUNTS.people} people in your care, as of today.`),
    ).toBeVisible();
    await expectCards(page, [
      ['Not started', SUYNL_COUNTS.not_started],
      ['In progress', SUYNL_COUNTS.in_progress],
      ['Graduated', SUYNL_COUNTS.graduated],
    ]);
    await expectReadOnly(page);
    await expect(page.getByRole('link', { name: 'Tick lessons in Growth' })).toHaveAttribute(
      'href',
      '/growth/suynl',
    );
  });

  test('Training shows its six counts and says a period counts only dated graduations', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockTraining(page);
    await page.goto('/reports/training');

    await expect(
      page.getByText(`Training for the ${TRAINING_COUNTS.people} people in your care, as of today.`),
    ).toBeVisible();
    await expectCards(page, [
      ['Encounter', TRAINING_COUNTS.encounter],
      ['Life Class', TRAINING_COUNTS.life_class],
      ['SOL 1', TRAINING_COUNTS.sol_1],
      ['SOL 2', TRAINING_COUNTS.sol_2],
      ['SOL 3', TRAINING_COUNTS.sol_3],
      ['None yet', TRAINING_COUNTS.not_started],
    ]);
    // Section 28: the consequence of an optional date is stated on the screen.
    await expect(
      page.getByText('A count of graduations in a period counts only the dated ones.'),
    ).toBeVisible();
    await expectReadOnly(page);
    await expect(page.getByRole('link', { name: 'Record graduations in Growth' })).toHaveAttribute(
      'href',
      '/growth/training',
    );
  });

  test('Conquest shows its four counts, read only, and sends each person to Growth', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockConquest(page);
    await page.goto('/reports/conquest');

    await expect(
      page.getByText(`The four goals for the ${CONQUEST_COUNTS.people} people in your care, as of today.`),
    ).toBeVisible();
    await expectCards(page, [
      ['Win 3', CONQUEST_COUNTS.win_3],
      ['Open a cell', CONQUEST_COUNTS.open_a_cell],
      ['Completion of 12', CONQUEST_COUNTS.completion_of_12],
      ['Raise 12 leaders', CONQUEST_COUNTS.raise_12_leaders],
    ]);
    await expectReadOnly(page);
    await expect(page.getByRole('link', { name: 'See each person in Growth' })).toHaveAttribute(
      'href',
      '/growth/conquest',
    );
  });

  test('none of the three reads a Growth list or writes, whatever month the address carries', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockSuynl(page);
    await mockTraining(page);
    await mockConquest(page);

    const asked: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (/^\/api\/v1\/(suynl|training|conquest)\//.test(url.pathname)) {
        asked.push(`${request.method()} ${url.pathname}${url.search}`);
      }
    });

    for (const path of ['/reports/suynl', '/reports/training', '/reports/conquest']) {
      await page.goto(`${path}?month=2026-05-01`);
      await expect(page.locator('main dl').getByRole('definition').first()).not.toHaveText('–');
      // As of now: no month is offered, because these are never counted by period.
      await expect(page.getByRole('button', { name: /^Show / })).toHaveCount(0);
      await expect(page.getByText('May 2026')).toHaveCount(0);
    }

    // Counts only: the same count routes as Growth, never its lists and never a submission.
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter((line) => !/^GET \/api\/v1\/(suynl|training|conquest)\/counts$/.test(line))).toEqual(
      [],
    );
  });
});

test.describe('the tabs at a phone, a tablet and a desktop', () => {
  /** Two across on a phone, three from `sm`, six from `lg` (decision 0292). */
  const LAYOUTS = [
    { width: 375, height: 812, columns: 2, rows: 3 },
    { width: 768, height: 1024, columns: 3, rows: 2 },
    { width: 1280, height: 800, columns: 6, rows: 1 },
  ] as const;

  for (const layout of LAYOUTS) {
    test(`at ${layout.width}px the six tabs sit ${layout.columns} across, and no report scrolls sideways`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.clock.setFixedTime(NOW);
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await mockEveryReport(page);

      for (const tab of TABS) {
        await page.goto(tab.path);
        const which = page.getByRole('navigation', { name: 'Which report' });
        await expect(which.getByRole('link')).toHaveCount(6);
        await expect(page.locator('main').getByText('Loading…')).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);

        const boxes = await which.getByRole('link').evaluateAll((links) =>
          links.map((link) => {
            const box = link.getBoundingClientRect();
            return {
              text: link.textContent,
              left: Math.round(box.left),
              top: Math.round(box.top),
              width: box.width,
              height: box.height,
              scroll: link.scrollWidth,
              client: link.clientWidth,
            };
          }),
        );

        expect(new Set(boxes.map((box) => box.left)).size, `${tab.path}: columns`).toBe(layout.columns);
        expect(new Set(boxes.map((box) => box.top)).size, `${tab.path}: rows`).toBe(layout.rows);
        for (const box of boxes) {
          expect(box.height, `${box.text} is ${box.height}px tall`).toBeGreaterThanOrEqual(44);
          expect(box.scroll, `${box.text} does not fit its tab`).toBeLessThanOrEqual(box.client);
        }
        // Equal buttons: every tab as wide as the others, within a pixel.
        const widths = boxes.map((box) => box.width);
        expect(Math.max(...widths) - Math.min(...widths), `${tab.path}: unequal tabs`).toBeLessThanOrEqual(1);

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth, `${tab.path} scrolls sideways at ${layout.width}px`).toBeLessThanOrEqual(
          clientWidth,
        );
      }
    });
  }
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
