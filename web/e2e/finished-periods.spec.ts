import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn, mockWholeChurchReader } from './mock-api';
import {
  mockCellReport,
  mockCellTwelve,
  mockDccReport,
  mockDccTwelve,
  TWELVE,
} from './mock-attendance';

/**
 * Quarterly and Year for a reader without Reports at Whole Church (SKILL.md section 19,
 * decision 0310): finished periods only, the last four quarters and the last year, none
 * ending before the DCC calendar's first Sunday, on Cell Groups and DCC alike. A
 * whole-church reader keeps every period.
 *
 * The calendar's first Sunday is 6 September 2026 unless a case says otherwise, so on
 * 4 October 2026 a leader's only quarter is Q3, still open for late records until the 7th.
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
const after = (page: Page) => page.getByRole('button', { name: 'The period after' });

for (const each of TABS) {
  test.describe(`${each.tab}: a leader`, () => {
    test('Quarterly opens on the last finished quarter, still open, and says when the next opens', async ({
      page,
    }) => {
      const asked = await arrange(page, each);
      await page.goto(`/reports/${each.tab}?period=quarter`);

      await expect(label(page, 'Q3 2026 · Jul–Sep')).toBeVisible();
      await expect(page.getByText(/^Open until 7 [A-Z][a-z]+$/)).toBeVisible();
      await expect(page.getByText('Q4 2026 · Oct–Dec opens on 1 January.', { exact: true })).toBeVisible();
      // Q2 ended before the calendar's first Sunday, and Q4 has not finished.
      await expect(before(page)).toBeDisabled();
      await expect(after(page)).toBeDisabled();
      await expect(page.getByRole('heading', { name: 'My 12 · their journey' })).toBeVisible();
      // The running quarter is never asked for, so no figure of it is ever shown.
      expect(asked.map((query) => query.get('start'))).not.toContain('2026-10-01');
    });

    test('Year is not offered until a whole year has finished', async ({ page }) => {
      const asked = await arrange(page, each);
      await page.goto(`/reports/${each.tab}?period=year`);

      await expect(page.getByRole('heading', { name: 'Year opens on 1 January 2027' })).toBeVisible();
      await expect(
        page.getByText(
          'A year is shown once it has finished. Until then, Quarterly shows each finished quarter.',
        ),
      ).toBeVisible();
      await expect(before(page)).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /their journey/ })).toHaveCount(0);
      expect(asked.map((query) => query.get('start'))).not.toContain('2026-01-01');
    });

    test('an address outside the reach opens the latest quarter, and says so', async ({ page }) => {
      await arrange(page, each);

      await page.goto(`/reports/${each.tab}?period=quarter&start=2026-10-01`);
      await expect(
        page.getByText(
          'Q4 2026 · Oct–Dec opens on 1 January, so this is the latest quarter you can see.',
        ),
      ).toBeVisible();
      await expect(label(page, 'Q3 2026 · Jul–Sep')).toBeVisible();

      await page.goto(`/reports/${each.tab}?period=quarter&start=2026-01-01`);
      await expect(
        page.getByText(
          'Q1 2026 · Jan–Mar is earlier than you can see here, so this is the latest quarter you can see.',
        ),
      ).toBeVisible();
      await expect(label(page, 'Q3 2026 · Jul–Sep')).toBeVisible();
    });

    test('in January the last quarter and the last year open, back to the calendar start', async ({
      page,
    }) => {
      await arrange(page, each, { today: '2027-01-15' });

      await page.goto(`/reports/${each.tab}?period=quarter`);
      await expect(label(page, 'Q4 2026 · Oct–Dec')).toBeVisible();
      await expect(page.getByText('Q1 2027 · Jan–Mar opens on 1 April.', { exact: true })).toBeVisible();
      await before(page).click();
      await expect(label(page, 'Q3 2026 · Jul–Sep')).toBeVisible();
      await expect(before(page)).toBeDisabled();

      await page.goto(`/reports/${each.tab}?period=year`);
      await expect(label(page, '2026')).toBeVisible();
      await expect(page.getByText('2027 opens on 1 January 2028.', { exact: true })).toBeVisible();
      await expect(before(page)).toBeDisabled();
    });

    test('a leader they opened who has since left their branch still shows a quarter they may read', async ({
      page,
    }) => {
      await arrange(page, each, { today: '2027-01-15' });
      // Consuelo is outside the reader's reach at the end of Q4 2026 and inside it at the end
      // of Q3 (decisions 0207 and 0214): only her latest quarter is refused.
      await page.route(`**/api/v1/reports/${each.tab}/twelve*`, (route) => {
        const params = new URL(route.request().url()).searchParams;
        return params.get('leader_id') === TWELVE.consuelo.id && params.get('start') === '2026-10-01'
          ? route.fulfill({
              status: 403,
              contentType: 'application/json',
              body: JSON.stringify({
                error: { code: 'SCOPE_DENIED', message: 'Outside your scope.', details: {} },
              }),
            })
          : route.fallback();
      });

      await page.goto(
        `/reports/${each.tab}?period=quarter&start=2026-07-01&leader=${TWELVE.consuelo.id}`,
      );
      await expect(label(page, 'Q3 2026 · Jul–Sep')).toBeVisible();
      await expect(page.getByRole('heading', { name: /’s 12 · their journey$/ })).toBeVisible();
      await expect(page.getByText('Outside your scope.')).toHaveCount(0);
    });

    test('reaches back four quarters and no further', async ({ page }) => {
      await arrange(page, each, { today: '2027-10-04' });
      await page.goto(`/reports/${each.tab}?period=quarter`);

      await expect(label(page, 'Q3 2027 · Jul–Sep')).toBeVisible();
      for (const previous of ['Q2 2027 · Apr–Jun', 'Q1 2027 · Jan–Mar', 'Q4 2026 · Oct–Dec']) {
        await before(page).click();
        await expect(label(page, previous)).toBeVisible();
      }
      await expect(before(page)).toBeDisabled();
    });

    test('before the DCC calendar has a first Sunday, neither is available yet', async ({ page }) => {
      await arrange(page, each, { calendarStart: null });

      await page.goto(`/reports/${each.tab}?period=quarter`);
      await expect(page.getByRole('heading', { name: 'Quarterly isn’t available yet' })).toBeVisible();
      await expect(
        page.getByText('It opens once the first quarter of DCC records has finished.'),
      ).toBeVisible();

      await page.goto(`/reports/${each.tab}?period=year`);
      await expect(page.getByRole('heading', { name: 'Year isn’t available yet' })).toBeVisible();
    });

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
      await expect(page.getByText(/^Open until 7 [A-Z][a-z]+$/)).toBeVisible();
      await expect(before(page)).toBeEnabled();
      await expect(page.getByText(/opens on/)).toHaveCount(0);

      await page.goto(`/reports/${each.tab}?period=year`);
      await expect(label(page, '2026')).toBeVisible();
      await expect(page.getByText(/opens on/)).toHaveCount(0);
    });
  });

  for (const width of [320, 690, 1280]) {
    test(`${each.tab}: at ${width}px a leader's quarter and year scroll nothing sideways`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await arrange(page, each);

      for (const address of [
        `/reports/${each.tab}?period=quarter`,
        `/reports/${each.tab}?period=quarter&start=2026-10-01`,
        `/reports/${each.tab}?period=year`,
      ]) {
        await page.goto(address);
        await expect(page.getByText(/opens on/).first()).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `${address} scrolls sideways at ${width}px`,
        ).toBe(true);
      }
    });
  }
}
