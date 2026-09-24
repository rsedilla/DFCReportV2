import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import { CONQUEST_ALL, CONQUEST_NONE, CONQUEST_PARTWAY, mockConquest } from './mock-growth';

/**
 * The Conquest tab of Growth, read-only (SKILL.md section 27; decisions 0283 to 0286, and
 * the owner's choices of 2026-09-24).
 *
 * `accessibility.spec.ts` scans the screen; these cases pin what it says. A reached goal
 * shows the month it was first reached with today's count beneath it, never instead of it,
 * and one not reached shows how far it is (section 27, *Reached once is reached*). Every
 * goal is derived, so there is nothing to tick and no save bar (section 28). Nothing in the
 * table is coloured or graded (sections 13, 17 and 19).
 *
 * Run at the default desktop width, where the rows render as a table; one case runs at a
 * phone's width, where they render as a list.
 */

function lastList(lists: URLSearchParams[]): URLSearchParams {
  return lists[lists.length - 1];
}

async function openConquest(page: Page, address = '/growth/conquest') {
  await mockSignedIn(page);
  const traffic = await mockConquest(page);
  await page.goto(address);
  await expect(page.getByRole('link', { name: 'Dalisay Soriano' }).first()).toBeVisible();
  return traffic;
}

/** The lines a goal cell shows, in order. */
function linesOf(cell: Locator): Locator {
  return cell.locator('span');
}

/** A row's cells: the person, the four goals in ladder order, and the goals column. */
function cellsOf(page: Page, name: string) {
  const cells = page.getByRole('row', { name: new RegExp(name) }).getByRole('cell');
  return {
    win3: cells.nth(1),
    openACell: cells.nth(2),
    completion: cells.nth(3),
    raise: cells.nth(4),
    goals: cells.nth(5),
  };
}

test.describe('the Conquest tab', () => {
  test('is a Growth tab, marked as the current page', async ({ page }) => {
    await openConquest(page);

    const tabs = page.getByRole('navigation', { name: 'Growth' });
    await expect(tabs.getByRole('link')).toHaveText(['SUYNL', 'Training', 'Conquest']);
    await expect(tabs.getByRole('link', { name: 'Conquest' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(tabs.getByRole('link', { name: 'SUYNL' })).not.toHaveAttribute('aria-current');
    await expect(tabs.getByRole('link', { name: 'Training' })).not.toHaveAttribute('aria-current');

    const current = page
      .getByRole('navigation', { name: 'Main' })
      .locator('a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText('Growth');
  });

  test('shows the four counts, and a card narrows the list and the address', async ({ page }) => {
    const traffic = await openConquest(page);

    await expect(page.getByText('3 people.', { exact: false })).toBeVisible();
    const win3 = page.getByRole('button', { name: /^Win 3/ });
    const openACell = page.getByRole('button', { name: /^Open a cell/ });
    const completion = page.getByRole('button', { name: /^Completion of 12/ });
    const raise = page.getByRole('button', { name: /^Raise 12 leaders/ });
    await expect(win3).toContainText('2');
    await expect(openACell).toContainText('2');
    await expect(completion).toContainText('2');
    await expect(raise).toContainText('1');
    expect(lastList(traffic.lists).has('goal')).toBe(false);

    await raise.click();

    await expect(page).toHaveURL(/[?&]goal=RAISE_12_LEADERS\b/);
    await expect(raise).toHaveAttribute('aria-pressed', 'true');
    await expect(win3).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => lastList(traffic.lists).get('goal')).toBe('RAISE_12_LEADERS');

    // Pressing the chosen card again clears it.
    await raise.click();

    await expect(page).not.toHaveURL(/goal=/);
    await expect(raise).toHaveAttribute('aria-pressed', 'false');
  });

  test('reads a card from the address, and ignores a goal it does not know', async ({ page }) => {
    const traffic = await openConquest(page, '/growth/conquest?goal=OPEN_A_CELL');

    await expect(page.getByRole('button', { name: /^Open a cell/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(lastList(traffic.lists).get('goal')).toBe('OPEN_A_CELL');

    await page.goto('/growth/conquest?goal=WIN_12');
    await expect(page.getByRole('link', { name: 'Dalisay Soriano' }).first()).toBeVisible();
    await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(0);
    expect(lastList(traffic.lists).has('goal')).toBe(false);
  });

  test('sends mine=true for "Only my disciples"', async ({ page }) => {
    const traffic = await openConquest(page);
    expect(lastList(traffic.lists).has('mine')).toBe(false);

    await page.getByRole('button', { name: 'Only my disciples' }).click();

    await expect(page).toHaveURL(/[?&]mine=1\b/);
    await expect.poll(() => lastList(traffic.lists).get('mine')).toBe('true');
  });

  test('shows a reached goal as its month, with today’s count beneath it', async ({ page }) => {
    await openConquest(page);
    const row = cellsOf(page, CONQUEST_PARTWAY.full_name);

    // Below the target today.
    await expect(linesOf(row.win3)).toHaveText(['Reached Mar 2026', '2 of 3 now']);
    // Past the target today, which reads as a count rather than "13 of 12".
    await expect(linesOf(row.completion)).toHaveText(['Reached Jan 2026', '13 now']);

    const all = cellsOf(page, CONQUEST_ALL.full_name);
    // At the target today.
    await expect(linesOf(all.completion)).toHaveText(['Reached Nov 2025', '12 of 12 now']);
    await expect(linesOf(all.raise)).toHaveText(['Reached Mar 2026', '11 of 12 now']);
    await expect(linesOf(all.win3)).toHaveText(['Reached Jan 2025', '3 of 3 now']);
  });

  test('shows a goal not yet reached as how far it is, out of its target', async ({ page }) => {
    await openConquest(page);

    const partway = cellsOf(page, CONQUEST_PARTWAY.full_name);
    await expect(linesOf(partway.raise)).toHaveText(['7 of 12 so far']);

    const none = cellsOf(page, CONQUEST_NONE.full_name);
    await expect(linesOf(none.win3)).toHaveText(['0 of 3 so far']);
    await expect(linesOf(none.completion)).toHaveText(['4 of 12 so far']);
    await expect(linesOf(none.raise)).toHaveText(['0 of 12 so far']);
  });

  test('shows Open a cell as its month or "Not yet", with no count', async ({ page }) => {
    await openConquest(page);

    await expect(linesOf(cellsOf(page, CONQUEST_PARTWAY.full_name).openACell)).toHaveText([
      'Reached Nov 2025',
    ]);
    await expect(linesOf(cellsOf(page, CONQUEST_NONE.full_name).openACell)).toHaveText(['Not yet']);
  });

  test('counts each person’s goals reached out of four', async ({ page }) => {
    await openConquest(page);

    await expect(cellsOf(page, CONQUEST_PARTWAY.full_name).goals).toHaveText('3 of 4');
    await expect(cellsOf(page, CONQUEST_NONE.full_name).goals).toHaveText('0 of 4');
    // A person who reached all four carries a plain label rather than an accented tag.
    await expect(cellsOf(page, CONQUEST_ALL.full_name).goals).toHaveText('4 of 4');
  });

  test('offers nothing to tick and no save bar', async ({ page }) => {
    await openConquest(page);

    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Discard' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
    await expect(page.locator('main textarea')).toHaveCount(0);
  });

  test('colours no goal, count or person in the table', async ({ page }) => {
    await openConquest(page);
    await expect(page.getByRole('table')).toBeVisible();

    // Every class on the table body and everything in it. A focus ring is the one use of
    // the accent a control is owed (WCAG 2.4.7), so a `focus-visible:` utility is set aside.
    const classes = await page
      .locator('main table tbody')
      .evaluate((body) =>
        [body, ...Array.from(body.querySelectorAll('*'))].flatMap((node) =>
          Array.from(node.classList),
        ),
      );
    expect(classes.length).toBeGreaterThan(0);

    const coloured = classes.filter(
      (token) =>
        !token.startsWith('focus-visible:') &&
        (/accent/.test(token) ||
          /(^|:)bg-/.test(token) ||
          /(^|:)(text|border|outline|ring|fill|stroke)-(red|green|amber|yellow|lime|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|orange|success|danger|warning|positive|negative)\b/.test(
            token,
          )),
    );
    expect(coloured).toEqual([]);
  });

  test('carries the same labels on a phone, where the rows are a list', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openConquest(page);

    const item = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: CONQUEST_PARTWAY.full_name }) });
    await expect(item).toBeVisible();
    await expect(item).toContainText('3 of 4');
    await expect(item.getByRole('definition')).toHaveText([
      'Reached Mar 20262 of 3 now',
      'Reached Nov 2025',
      'Reached Jan 202613 now',
      '7 of 12 so far',
    ]);
    await expect(item.getByRole('term')).toHaveText([
      'Win 3',
      'Open a cell',
      'Completion of 12',
      'Raise 12 leaders',
    ]);
  });

  // The owner saw the four cards at different heights where two labels wrap (2026-09-24).
  for (const width of [1440, 1024, 390]) {
    test(`draws the four cards the same height at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openConquest(page);
      await page.evaluate(() => document.fonts.ready);

      const heights = await page
        .getByRole('button', { name: /Show these|Showing these/ })
        .evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().height)));
      // Cards on one row share a height; at 390px they sit two to a row.
      const rows = width === 390 ? [heights.slice(0, 2), heights.slice(2, 4)] : [heights];
      expect(heights).toHaveLength(4);
      for (const row of rows) {
        expect(new Set(row).size).toBe(1);
      }
    });
  }

  // The owner asked for the row of cards to fill the screen's width (2026-09-24).
  for (const width of [1440, 1024]) {
    test(`fills the row with the four cards at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openConquest(page);

      const cards = page.getByRole('button', { name: /Show these|Showing these/ });
      const first = await cards.first().boundingBox();
      const last = await cards.last().boundingBox();
      const bar = await page.locator('form').filter({ has: page.getByRole('searchbox') }).boundingBox();
      if (!first || !last || !bar) throw new Error('A card or the search bar was not laid out.');

      expect(Math.round(first.y)).toBe(Math.round(last.y));
      expect(Math.abs(first.x - bar.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(last.x + last.width - (bar.x + bar.width))).toBeLessThanOrEqual(1);
    });
  }
});
