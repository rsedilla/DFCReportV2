import { expect, test } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import { mockBranchCounts, mockBranchTrends } from './mock-senior-pastor';

/**
 * A Full view leader's *# of Cell Groups*, *# of Cell Leaders* and *Last 12 months* (SKILL.md
 * section 19, decision 0380): the Senior Pastors' figures for the reader's own branch, names as
 * plain text, and one line with no Show list and no bars. Names are invented (CLAUDE.md, Secrets).
 */

/** 10:00 on 8 October 2026 in Manila. */
const OCTOBER_8 = new Date('2026-10-08T02:00:00Z');

/** The signed-in reader's person, as `mock-api.ts` gives it. */
const READER = '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9';

test.describe('a Full view leader’s # of Cell Groups and # of Cell Leaders', () => {
  test('# of Cell Groups counts their branch by category, rows adding up to the box', async ({
    page,
  }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSignedIn(page);
    const asked = await mockBranchCounts(page);
    await page.goto('/reports/number-of-cells');

    const region = page.getByRole('region', { name: 'Number of Cell Groups' });
    await expect(region.getByRole('heading', { name: 'Your Disciples' })).toBeVisible();
    await expect(region.locator('dl')).toHaveText(/Total\s*10\s*Youth\s*5\s*Young Pro\s*3\s*Couple\s*2/);
    const table = page.getByRole('table', { name: 'Your 12' });
    await expect(table.getByRole('columnheader')).toHaveText([
      'Leader',
      'Total',
      'Youth',
      'Young Pro',
      'Couple',
    ]);
    await expect(table.locator('tbody tr')).toHaveText([
      /^Consuelo Bautista\s*4\s*2\s*1\s*1$/,
      /^Efren Dimaculangan\s*2\s*1\s*1\s*0$/,
      /^A leader not named here\s*3\s*1\s*1\s*1$/,
      /^You\s*1\s*1\s*0\s*0$/,
      /^Total\s*10\s*5\s*3\s*2$/,
    ]);
    // A name is plain text and opens nothing (decision 0380).
    await expect(table.getByRole('link')).toHaveCount(0);
    expect(asked[0]).toEqual({ leader: READER, period: '2026-10-01' });
  });

  test('# of Cell Leaders counts the people leading a Cell in their branch', async ({ page }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSignedIn(page);
    await mockBranchCounts(page);
    await page.goto('/reports/number-of-cell-leaders');

    const table = page.getByRole('table', { name: 'Your 12' });
    await expect(table.getByRole('columnheader')).toHaveText(['Leader', 'Cell Leaders']);
    await expect(table.locator('tbody tr')).toHaveText([
      /^Consuelo Bautista\s*3$/,
      /^Efren Dimaculangan\s*2$/,
      /^A leader not named here\s*1$/,
      /^You\s*1$/,
      /^Total\s*7$/,
    ]);
    await expect(table.getByRole('link')).toHaveCount(0);
    const which = page.getByRole('navigation', { name: 'Which report' });
    await expect(which.locator('a[aria-current="page"]')).toHaveText('# of Cell Leaders');
  });
});

test.describe('a Full view leader’s Last 12 months', () => {
  test('is reached by the one switch, keeping the tab (decision 0398)', async ({ page }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSignedIn(page);
    await mockBranchCounts(page);
    await mockBranchTrends(page);
    await page.goto('/reports/number-of-cells');

    const view = page.getByRole('group', { name: 'Report period' });
    await expect(view.getByRole('button')).toHaveText(['Monthly', '12 Months']);
    await view.getByRole('button', { name: '12 Months' }).click();
    await expect(page).toHaveURL(/\/trends\?figure=CELLS$/);
    await expect(
      page.getByRole('navigation', { name: 'Which report' }).locator('a[aria-current="page"]'),
    ).toHaveText('# of Cell Groups');
  });

  test('draws their own branch alone, as a line, with no Show list and no bars', async ({ page }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSignedIn(page);
    const asked = await mockBranchTrends(page);
    await page.goto('/trends?figure=CG');

    await expect(page.getByRole('heading', { name: 'CG Attendance · Your branch' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Show' })).toHaveCount(0);
    // The one switch, its twelve months chosen, and no month to step (decision 0398).
    const view = page.getByRole('group', { name: 'Report period' });
    await expect(view.getByRole('button')).toHaveText(['Weekly', 'Monthly', '12 Months']);
    await expect(view.getByRole('button', { name: '12 Months' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'The period before' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Graph' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Bars' })).toHaveCount(0);
    await expect(page.locator('main svg[role="img"] polyline').first()).toBeVisible();
    await expect(page.locator('main svg[role="img"] rect')).toHaveCount(0);
    // In their Network's colour, as the Senior Pastors' Trends draw that branch (decision
    // 0388): the mock names the Women's Network.
    await expect(page.locator('main svg[role="img"] g.text-chart-pink')).toHaveCount(1);

    // Its own route, for the reader, ending with the month running.
    await expect.poll(() => asked.length).toBeGreaterThan(0);
    expect(Object.fromEntries(asked[0])).toEqual({
      figure: 'CG',
      scope: 'LEADER',
      leader_id: READER,
      period: '2026-10-01',
    });

    // The figures stay one click away, one column, the gap said in words.
    await page.getByText('Show the figures').click();
    const figures = page.getByRole('table', { name: 'CG Attendance by month' });
    await expect(figures.getByRole('columnheader')).toHaveText(['Month', 'Your branch']);
    await expect(figures.getByText('could not be read')).toHaveCount(1);
  });

  for (const [network, tone] of [
    ['MENS', 'text-chart-blue'],
    [null, 'text-ink'],
  ] as const) {
    test(`draws a ${network ?? 'no-Network'} leader's branch in ${tone} (decision 0388)`, async ({
      page,
    }) => {
      await page.clock.setFixedTime(OCTOBER_8);
      await mockSignedIn(page);
      await mockBranchTrends(page, network);
      await page.goto('/trends?figure=CG');

      await expect(page.locator('main svg[role="img"] polyline').first()).toBeVisible();
      await expect(page.locator(`main svg[role="img"] g.${tone}`)).toHaveCount(1);
    });
  }

  test('never asks for the church or another leader, whatever the address says', async ({
    page,
  }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSignedIn(page);
    const asked = await mockBranchTrends(page);
    const church: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/reports/trends?') || url.includes('/reports/church-counts')) {
        church.push(url);
      }
    });
    await page.goto('/trends?figure=PEOPLE&leader=3f1b7c6e-0000-4000-8000-000000000701');

    await expect(page.getByRole('heading', { name: 'Number of people · Your branch' })).toBeVisible();
    expect(asked.every((query) => query.get('leader_id') === READER)).toBe(true);
    expect(church).toEqual([]);
  });

  test('scrolls nothing sideways on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSignedIn(page);
    await mockBranchTrends(page);
    await page.goto('/trends');

    await expect(page.getByRole('heading', { name: 'CG Attendance · Your branch' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
