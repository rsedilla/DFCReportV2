import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn, mockWholeChurchReader } from './mock-api';
import { mockCellReport, mockCellTwelve, mockDccReport, mockDccTwelve } from './mock-attendance';

/**
 * Quarterly and Year (SKILL.md section 19). A whole-church reader keeps every period. A Full view
 * leader, the only reader on these screens without Reports at Whole Church, is offered Weekly and
 * Monthly alone (decision 0380), so decision 0310's finished quarters and years reach nobody here.
 */

const TABS = [
  { tab: 'cells', twelve: mockCellTwelve, monthly: mockCellReport },
  { tab: 'dcc', twelve: mockDccTwelve, monthly: mockDccReport },
] as const;

async function arrange(
  page: Page,
  tab: (typeof TABS)[number],
  { today = '2026-10-04', calendarStart = '2026-09-06' as string | null, church = false } = {},
) {
  await page.clock.setFixedTime(new Date(`${today}T02:00:00Z`));
  await mockSignedIn(page);
  if (church) {
    await mockWholeChurchReader(page);
  }
  await tab.monthly(page);
  return tab.twelve(page, { today, calendarStart });
}

const label = (page: Page, text: string) => page.locator('main').getByText(text, { exact: true });
const before = (page: Page) => page.getByRole('button', { name: 'The period before' });

for (const each of TABS) {
  test.describe(`${each.tab}: a Full view leader`, () => {
    // Offered Weekly and Monthly alone (decision 0380), so decision 0310's finished quarters
    // and years reach no reader on these screens; an address naming one opens the month.
    test('is offered Weekly and Monthly alone', async ({ page }) => {
      await arrange(page, each);
      await page.goto(`/reports/${each.tab}`);

      await expect(
        page.getByRole('group', { name: 'Report period' }).getByRole('button'),
      ).toHaveText(['Weekly', 'Monthly']);
    });

    for (const period of ['quarter', 'year']) {
      test(`an address naming a ${period} opens the running month`, async ({ page }) => {
        const asked = await arrange(page, each);
        await page.goto(`/reports/${each.tab}?period=${period}`);

        await expect(label(page, 'October 2026')).toBeVisible();
        await expect(page.getByText(/opens on/)).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Your Disciples' })).toBeVisible();
        expect(asked.map((query) => query.get('kind'))).not.toContain(period.toUpperCase());
      });
    }

    test('Monthly still opens on the running month', async ({ page }) => {
      await arrange(page, each);
      await page.goto(`/reports/${each.tab}`);
      await expect(label(page, 'October 2026')).toBeVisible();
      await expect(page.getByText(/opens on/)).toHaveCount(0);
    });
  });

  test.describe(`${each.tab}: a whole-church reader`, () => {
    test('keeps the running quarter and year, with no new lines', async ({ page }) => {
      await arrange(page, each, { church: true });

      await page.goto(`/reports/${each.tab}?period=quarter`);
      await expect(label(page, 'Q4 2026 · Oct–Dec')).toBeVisible();
      await expect(page.getByText(/^Open until Mon \d+ [A-Z][a-z]{2}, 12NN$/)).toBeVisible();
      await expect(before(page)).toBeEnabled();
      await expect(page.getByText(/opens on/)).toHaveCount(0);

      await page.goto(`/reports/${each.tab}?period=year`);
      await expect(label(page, '2026')).toBeVisible();
      await expect(page.getByText(/opens on/)).toHaveCount(0);
    });
  });

}
