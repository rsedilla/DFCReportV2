import { expect, test, type Page } from '@playwright/test';

import { mockScreens, mockSignedIn } from './mock-api';
import { mockCellTwelve, mockDccEvents, mockDccRoster, mockDccTwelve } from './mock-attendance';
import {
  SP_MENS_ROOT,
  SP_PRIMARIES,
  SP_WOMENS_ROOT,
  mockChurchCounts,
  mockRootLeadersTwelve,
  mockTrends,
} from './mock-senior-pastor';

/**
 * The two Senior Pastors' `Reports` and `Trends` (SKILL.md sections 17, 19 and 23; decisions
 * 0326 and 0327).
 *
 * These pin what the client shows and sends; the API's figures, their reconciliation and who
 * may read them are pinned in `api/test/api/senior-pastor-reports.e2e.spec.ts`. Names are
 * invented (`CLAUDE.md`, Secrets).
 */

/** 10:00 on Thursday 8 October 2026 in Manila: October is the current month. */
const OCTOBER_8 = new Date('2026-10-08T02:00:00Z');

async function seniorPastor(page: Page) {
  await page.clock.setFixedTime(OCTOBER_8);
  await mockSignedIn(page);
  await mockScreens(page, 'SENIOR_PASTOR');
}

const MENS_TABLE = `${SP_MENS_ROOT.full_name}’s leaders`;
const WOMENS_TABLE = `${SP_WOMENS_ROOT.full_name}’s leaders`;

test.describe('the Senior Pastors’ Reports tabs (decision 0327)', () => {
  test('are CG attendance, DCC attendance and the three counts, each count named in words', async ({
    page,
  }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);

    await page.goto('/reports/number-of-cells');

    const tabs = page.getByRole('navigation', { name: 'Which report' }).getByRole('link');
    await expect(tabs).toHaveText([
      'CG attendance',
      'DCC attendance',
      '# of Cells',
      '# of Cell Leaders',
      '# of people',
    ]);
    // A screen reader says `#` as "number sign", so each keeps its words as its name.
    for (const name of ['Number of Cells', 'Number of Cell Leaders', 'Number of people']) {
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Number of Cells', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Encounter candidates is withdrawn.
    await expect(page.getByRole('link', { name: /Encounter/ })).toHaveCount(0);
  });
});

test.describe('the three counts (decisions 0326 and 0327)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('# of Cells: Total and the three categories, a table per root headed Primaries', async ({
    page,
  }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);

    await page.goto('/reports/number-of-cells');

    const counts = page.getByRole('region', { name: 'Number of Cells' });
    await expect(counts.getByRole('term')).toHaveText(['Total', 'Youth', 'Young Pro', 'Couple']);
    await expect(counts.getByRole('definition')).toHaveText(['5', '1', '3', '1']);

    const mens = page.getByRole('table', { name: MENS_TABLE });
    await expect(mens.getByRole('columnheader')).toHaveText([
      'Primaries',
      'Total',
      'Youth',
      'Young Pro',
      'Couple',
    ]);
    // The server's order, and each name a link in the link colour to that Primary's branch.
    const names = mens.getByRole('link');
    await expect(names).toHaveText([SP_PRIMARIES.abad.full_name, SP_PRIMARIES.ocampo.full_name]);
    await expect(names.first()).toHaveClass(/text-accent/);
    await expect(names.first()).toHaveAttribute('href', `/network?focus=${SP_PRIMARIES.abad.id}`);
    await expect(mens.getByRole('row').nth(1).getByRole('cell')).toHaveText([
      SP_PRIMARIES.abad.full_name,
      '2',
      '0',
      '2',
      '0',
    ]);
    await expect(page.getByRole('table', { name: WOMENS_TABLE })).toBeVisible();
    await expect(page.getByText('Total 1 · Youth 0 · Young Pro 0 · Couple 1')).toBeVisible();
  });

  test('# of Cell Leaders and # of people each show their one figure', async ({ page }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);

    await page.goto('/reports/number-of-cell-leaders');
    const leaders = page.getByRole('region', { name: 'Number of Cell Leaders' });
    await expect(leaders.getByRole('term')).toHaveText(['Cell Leaders']);
    await expect(leaders.getByRole('definition')).toHaveText(['5']);
    await expect(page.getByRole('table', { name: MENS_TABLE }).getByRole('columnheader')).toHaveText([
      'Primaries',
      'Cell Leaders',
    ]);

    await page.goto('/reports/number-of-people');
    const people = page.getByRole('region', { name: 'Number of people' });
    await expect(people.getByRole('term')).toHaveText(['People']);
    await expect(people.getByRole('definition')).toHaveText(['36']);
  });

  test('step a month at a time with the same ‹ › control as the attendance tabs', async ({
    page,
  }) => {
    await seniorPastor(page);
    const asked = await mockChurchCounts(page);

    await page.goto('/reports/number-of-cell-leaders');

    await expect(page.getByText('October 2026', { exact: true })).toBeVisible();
    await expect(page.getByText('as at today, so far')).toBeVisible();
    // A month that has not begun is not reported (decision 0216).
    await expect(page.getByRole('button', { name: 'The period after' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /month/i })).toHaveCount(0);

    await page.getByRole('button', { name: 'The period before' }).click();

    await expect(page.getByText('September 2026', { exact: true })).toBeVisible();
    await expect(page.getByText('as at 30 September 2026')).toBeVisible();
    await expect.poll(() => asked.at(-1)).toBe('2026-09-01');
    // The month travels to the other tabs.
    await expect(page.getByRole('link', { name: 'Number of people', exact: true })).toHaveAttribute(
      'href',
      '/reports/number-of-people?month=2026-09-01',
    );
  });
});

test.describe('the Senior Pastors’ attendance tabs (decision 0327)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  async function attendance(page: Page) {
    await seniorPastor(page);
    await mockCellTwelve(page);
    await mockDccTwelve(page);
    await mockDccEvents(page);
    await mockDccRoster(page);
    // Last, so it answers the two pastors' request and lets every other twelve fall through.
    await mockRootLeadersTwelve(page);
  }

  test('CG attendance: Total first, a Primaries column, and nothing about recording', async ({
    page,
  }) => {
    await attendance(page);

    await page.goto('/reports/cells');

    const mens = page.getByRole('table', { name: MENS_TABLE });
    await expect(mens.getByRole('columnheader')).toHaveText([
      'Primaries',
      'Total',
      'VIP',
      '2nd Timer',
      '3rd Timer',
      '4th Timer',
      'Regular',
    ]);
    // A row's Total is its unique people, VIP through Regular added.
    await expect(mens.getByRole('row').nth(1).getByRole('cell')).toHaveText([
      SP_PRIMARIES.abad.full_name,
      '4',
      '1',
      '1',
      '0',
      '0',
      '2',
    ]);
    await expect(page.getByRole('table', { name: WOMENS_TABLE })).toBeVisible();

    await expect(page.getByText(/meetings recorded/)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'see Filed reports' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /How these are counted/i })).toHaveCount(0);
  });

  test('the period, the month and Figures for are one row, and an open month says so far', async ({
    page,
  }) => {
    await attendance(page);

    await page.goto('/reports/cells');

    const period = page.getByRole('group', { name: 'Report period' });
    const bar = period.locator('xpath=..');
    await expect(bar.getByRole('button', { name: 'The period before' })).toBeVisible();
    await expect(bar.getByLabel('Figures for')).toBeVisible();
    await expect(bar.getByText('· so far')).toBeVisible();
    await expect(page.getByText(/^Open until /)).toHaveCount(0);
  });

  test('DCC attendance shows no records filed and no Sundays counted', async ({ page }) => {
    await attendance(page);

    await page.goto('/reports/dcc');

    await expect(page.getByRole('table', { name: MENS_TABLE })).toBeVisible();
    await expect(page.getByText(/records filed/)).toHaveCount(0);
    await expect(page.getByText(/Sundays? counted/)).toHaveCount(0);
  });

  test('Year shows no month-by-month table', async ({ page }) => {
    await attendance(page);

    await page.goto('/reports/cells?period=year');

    await expect(page.getByRole('table', { name: MENS_TABLE })).toBeVisible();
    await expect(page.getByText(/Month by month/)).toHaveCount(0);
  });
});

test.describe('Trends (decisions 0326 and 0327)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  const graph = (page: Page) => page.getByRole('img', { name: /, November 2025 to October 2026: / });

  test('has the same five figures as tabs, keeping the leader chosen', async ({ page }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);
    const asked = await mockTrends(page);

    await page.goto(`/trends?leader=${SP_PRIMARIES.abad.id}`);

    const tabs = page.getByRole('navigation', { name: 'Which figure' }).getByRole('link');
    await expect(tabs).toHaveText([
      'CG attendance',
      'DCC attendance',
      '# of Cells',
      '# of Cell Leaders',
      '# of people',
    ]);
    await expect(page.getByRole('link', { name: 'Number of Cell Leaders', exact: true })).toHaveAttribute(
      'href',
      `/trends?figure=CELL_LEADERS&leader=${SP_PRIMARIES.abad.id}`,
    );

    await page.getByRole('link', { name: 'Number of Cell Leaders', exact: true }).click();
    await expect
      .poll(() => Object.fromEntries(asked.at(-1) ?? []))
      .toEqual({ figure: 'CELL_LEADERS', leader_id: SP_PRIMARIES.abad.id });
  });

  test('draws three lines with a key of tick boxes, one always staying ticked', async ({ page }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);
    await mockTrends(page);

    await page.goto('/trends');

    const church = page.getByRole('checkbox', { name: 'Whole Church' });
    const mens = page.getByRole('checkbox', { name: `${SP_MENS_ROOT.full_name} · Men’s` });
    const womens = page.getByRole('checkbox', { name: `${SP_WOMENS_ROOT.full_name} · Women’s` });
    for (const box of [church, mens, womens]) {
      await expect(box).toBeChecked();
    }
    // Each line breaks at March, the month that could not be read: two runs each.
    await expect(graph(page).locator('polyline')).toHaveCount(6);

    await church.uncheck();
    await expect(graph(page).locator('polyline')).toHaveCount(4);
    await expect(graph(page)).not.toHaveAttribute('aria-label', /Whole Church/);

    await mens.uncheck();
    // The last one ticked cannot be unticked, and is not greyed out either.
    await womens.click();
    await expect(womens).toBeChecked();
    await expect(womens).toBeEnabled();
    await expect(graph(page).locator('polyline')).toHaveCount(2);
  });

  test('draws bars on request, and the device remembers it and the ticks', async ({ page }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);
    await mockTrends(page);

    await page.goto('/trends');

    const shape = page.getByRole('group', { name: 'Graph' });
    await expect(shape.getByRole('button', { name: 'Line' })).toHaveAttribute('aria-pressed', 'true');
    await shape.getByRole('button', { name: 'Bars' }).click();

    // Eleven months read, three bars each, none of them zero.
    await expect(graph(page).locator('rect')).toHaveCount(33);
    await expect(page.getByText(/A lighter bar is a month still open, its figure so far: October 2026/)).toBeVisible();

    await page.getByRole('checkbox', { name: 'Whole Church' }).uncheck();
    await expect(graph(page).locator('rect')).toHaveCount(22);

    await page.reload();

    await expect(shape.getByRole('button', { name: 'Bars' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('checkbox', { name: 'Whole Church' })).not.toBeChecked();
    await expect(graph(page).locator('rect')).toHaveCount(22);
  });

  test('marks every month still open, a finished one inside its window too', async ({ page }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);
    // From the 1st to the 7th the month before is still open (sections 13, 17 and 19).
    await mockTrends(page, { open: ['2026-09-01', '2026-10-01'] });

    await page.goto('/trends');

    // A hollow point for each open month on each of the three lines.
    await expect(graph(page).locator('circle.fill-surface')).toHaveCount(6);
    await expect(
      page.getByText(/A hollow point is a month still open, its figure so far: September 2026 and October 2026/),
    ).toBeVisible();

    await page.getByText('Show the figures').click();
    const table = page.getByRole('table', { name: 'CG attendance by month' });
    for (const month of ['September 2026', 'October 2026']) {
      await expect(table.getByRole('row', { name: new RegExp(month) })).toContainText('so far');
    }
    await expect(table.getByRole('row', { name: /August 2026/ })).not.toContainText('so far');
  });

  test('keeps the figures behind Show the figures, following the ticks', async ({ page }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);
    await mockTrends(page);

    await page.goto('/trends');

    const toggle = page.getByText('Show the figures');
    await expect(page.getByRole('table')).toBeHidden();
    await toggle.click();
    await expect(page.getByText('Hide the figures')).toBeVisible();

    // Trends opens on CG attendance.
    const table = page.getByRole('table', { name: 'CG attendance by month' });
    await expect(table.getByRole('columnheader')).toHaveText([
      'Month',
      'Whole Church',
      `${SP_MENS_ROOT.full_name} · Men’s`,
      `${SP_WOMENS_ROOT.full_name} · Women’s`,
    ]);
    await expect(table.getByRole('row', { name: /March 2026/ })).toContainText('could not be read');

    await page.getByRole('checkbox', { name: 'Whole Church' }).uncheck();
    await expect(table.getByRole('columnheader')).toHaveCount(3);
  });

  test('colours the church green and each branch blue or pink, and one Primary by their branch', async ({
    page,
  }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);
    await mockTrends(page);

    await page.goto('/trends');
    await expect(graph(page).locator('g.text-chart-green')).toHaveCount(1);
    await expect(graph(page).locator('g.text-chart-blue')).toHaveCount(1);
    await expect(graph(page).locator('g.text-chart-pink')).toHaveCount(1);

    await page.goto(`/trends?leader=${SP_PRIMARIES.abad.id}`);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(graph(page).locator('g.text-chart-blue')).toHaveCount(1);

    await page.goto(`/trends?leader=${SP_PRIMARIES.bautista.id}`);
    await expect(graph(page).locator('g.text-chart-pink')).toHaveCount(1);
  });
});

// WCAG 2.5.8, measured here because the accessibility sweep signs in no Senior Pastor (its
// TARGET_EXEMPT entries for these screens point here). Measured as that sweep measures:
// focused, and by the label a control sits in where it has one.
for (const width of [390, 1280]) {
  for (const route of ['/reports/number-of-cells', '/trends']) {
    test(`every control on ${route} is at least 24 by 24 at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seniorPastor(page);
      await mockChurchCounts(page);
      await mockTrends(page);

      await page.goto(route);
      await expect(page.getByRole('link', { name: 'Number of people', exact: true })).toBeVisible();
      if (route === '/trends') {
        await expect(page.getByRole('checkbox', { name: 'Whole Church' })).toBeVisible();
      } else {
        await expect(page.getByRole('region', { name: 'Number of Cells' }).getByRole('term').first()).toBeVisible();
      }

      const targets = page.locator('main button, main a[href], main input, main select, main summary');
      const count = await targets.count();
      expect(count).toBeGreaterThanOrEqual(8);

      const small: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const target = targets.nth(index);
        if (!(await target.isVisible())) {
          continue;
        }
        await target.focus().catch(() => {});
        const measured = await target.evaluate((node) => {
          const rect = (node.closest('label') ?? node).getBoundingClientRect();
          const text = (node.textContent ?? '').trim().slice(0, 40);
          return { width: rect.width, height: rect.height, name: `${node.tagName}: ${text}` };
        });
        if (measured.width < 24 || measured.height < 24) {
          small.push(`${measured.name} (${measured.width} by ${measured.height})`);
        }
      }

      expect(small).toEqual([]);
    });
  }
}
