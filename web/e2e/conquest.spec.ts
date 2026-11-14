import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockSignedIn, mockWholeChurchReader } from './mock-api';
import { CONQUEST_ALL, CONQUEST_NONE, CONQUEST_PARTWAY, mockConquest } from './mock-growth';

/**
 * The Conquest page, an item of the sidebar of its own (decision 0407), read-only (SKILL.md section 27; decisions 0283 to 0286, and
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

// A whole-church reader by default: a Full view leader is shown the note (decisions 0360 and 0379).
async function openConquest(page: Page, address = '/conquest', church = true) {
  await mockSignedIn(page);
  if (church) {
    await mockWholeChurchReader(page);
  }
  const traffic = await mockConquest(page);
  await page.goto(address);
  await expect(page.getByRole('link', { name: 'Dalisay Soriano' }).first()).toBeVisible();
  return traffic;
}

/** The lines a goal cell shows, in order. */
function linesOf(cell: Locator): Locator {
  return cell.locator('span');
}

/** A row's goal cell on the tab open: the person, then that tab's goal (decision 0489). */
function goalOf(page: Page, name: string): Locator {
  return page.getByRole('row', { name: new RegExp(name) }).getByRole('cell').nth(1);
}

/** Opens one goal's tab. */
async function openTab(page: Page, label: string) {
  await page.getByRole('navigation', { name: 'Which goal' }).getByRole('link', { name: label }).click();
  await expect(
    page.getByRole('navigation', { name: 'Which goal' }).locator('a[aria-current="page"]'),
  ).toHaveText(label);
}

/** The count box of the tab open. */
function countBox(page: Page): Locator {
  return page.getByText('Reached', { exact: true }).locator('..');
}

test.describe('the Conquest page', () => {
  // A whole-church reader, as the Admin is: a Full view leader's page is hidden (decision 0360).
  test('is an item of the sidebar of its own, after Growth and current there (decision 0407)', async ({
    page,
  }) => {
    await openConquest(page, '/conquest', true);

    await expect(page.getByRole('heading', { name: 'Conquest', level: 1 })).toBeVisible();
    // Not a Growth tab and not a link above one.
    await expect(page.getByRole('navigation', { name: 'Growth' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Conquest goals/ })).toHaveCount(0);

    const main = page.getByRole('navigation', { name: 'Main' });
    const current = main.locator('a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText('Conquest');
    await expect(main.getByRole('link', { name: 'Conquest' })).toHaveAttribute('href', '/conquest');

    // Growth keeps SUYNL and Training, with no way to Conquest beside them.
    await main.getByRole('link', { name: 'Growth' }).click();
    await expect(page).toHaveURL(/\/growth\/suynl$/);
    await expect(
      page.getByRole('navigation', { name: 'Growth' }).getByRole('link'),
    ).toHaveText(['SUYNL', 'Training']);
    await expect(page.getByRole('link', { name: /Conquest goals/ })).toHaveCount(0);
  });

  test('forwards its old addresses, keeping the query (decision 0407)', async ({ page }) => {
    await openConquest(page, '/growth/conquest?goal=OPEN_A_CELL', true);
    // Anchored at the host: unanchored, the old address itself matches before it forwards.
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/conquest\?goal=OPEN_A_CELL$/);
    await page.goto('/reports/conquest?goal=WIN_3');
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/conquest\?goal=WIN_3$/);
  });

  test('has one tab per goal, Win 3 first, each with its count and everyone listed (decision 0489)', async ({
    page,
  }) => {
    const traffic = await openConquest(page);

    await expect(page.getByText('3 people you oversee, as of today.')).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Which goal' }).getByRole('link');
    await expect(tabs).toHaveText(['Win 3', 'Open a Cell', 'Completion of 12', 'Raise 12 Leaders']);
    await expect(tabs.first()).toHaveAttribute('aria-current', 'page');
    await expect(countBox(page)).toHaveText(/^Win 3\s*2\s*Reached$/);
    // No goal filter is sent: every tab lists everyone.
    expect(lastList(traffic.lists).has('goal')).toBe(false);
    await expect(page.getByRole('columnheader')).toHaveText(['Person', 'Win 3']);

    await openTab(page, 'Raise 12 Leaders');

    await expect(page).toHaveURL(/[?&]goal=RAISE_12_LEADERS\b/);
    await expect(countBox(page)).toHaveText(/^Raise 12 Leaders\s*1\s*Reached$/);
    await expect(page.getByRole('columnheader')).toHaveText(['Person', 'Raise 12 Leaders']);
    expect(lastList(traffic.lists).has('goal')).toBe(false);
    await expect(page.getByRole('row')).toHaveCount(4);
    // The count is read, not pressed.
    await expect(page.getByRole('button', { name: /Show these|Showing these/ })).toHaveCount(0);
  });

  test('reads the tab from the address, and opens Win 3 for a goal it does not know', async ({ page }) => {
    await openConquest(page, '/conquest?goal=OPEN_A_CELL');

    const current = page.getByRole('navigation', { name: 'Which goal' }).locator('a[aria-current="page"]');
    await expect(current).toHaveText('Open a Cell');

    await page.goto('/conquest?goal=WIN_12');
    await expect(page.getByRole('link', { name: 'Dalisay Soriano' }).first()).toBeVisible();
    await expect(current).toHaveText('Win 3');
  });

  test('a tab keeps the search and Only my disciples', async ({ page }) => {
    await openConquest(page, '/conquest?q=soriano&mine=1');

    await expect(
      page.getByRole('navigation', { name: 'Which goal' }).getByRole('link', { name: 'Raise 12 Leaders' }),
    ).toHaveAttribute('href', '/conquest?goal=RAISE_12_LEADERS&q=soriano&mine=1');
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

    // Below the target today.
    await expect(linesOf(goalOf(page, CONQUEST_PARTWAY.full_name))).toHaveText([
      'Reached Mar 2026',
      '2 of 3 now',
    ]);
    await expect(linesOf(goalOf(page, CONQUEST_ALL.full_name))).toHaveText([
      'Reached Jan 2025',
      '3 of 3 now',
    ]);

    await openTab(page, 'Completion of 12');
    // Past the target today, which reads as a count rather than "13 of 12".
    await expect(linesOf(goalOf(page, CONQUEST_PARTWAY.full_name))).toHaveText([
      'Reached Jan 2026',
      '13 now',
    ]);
    // At the target today.
    await expect(linesOf(goalOf(page, CONQUEST_ALL.full_name))).toHaveText([
      'Reached Nov 2025',
      '12 of 12 now',
    ]);

    await openTab(page, 'Raise 12 Leaders');
    await expect(linesOf(goalOf(page, CONQUEST_ALL.full_name))).toHaveText([
      'Reached Mar 2026',
      '11 of 12 now',
    ]);
  });

  test('shows a goal not yet reached as how far it is, out of its target', async ({ page }) => {
    await openConquest(page);
    await expect(linesOf(goalOf(page, CONQUEST_NONE.full_name))).toHaveText(['0 of 3 so far']);

    await openTab(page, 'Completion of 12');
    await expect(linesOf(goalOf(page, CONQUEST_NONE.full_name))).toHaveText(['4 of 12 so far']);

    await openTab(page, 'Raise 12 Leaders');
    await expect(linesOf(goalOf(page, CONQUEST_PARTWAY.full_name))).toHaveText(['7 of 12 so far']);
    await expect(linesOf(goalOf(page, CONQUEST_NONE.full_name))).toHaveText(['0 of 12 so far']);
  });

  test('shows Open a Cell as its month or "Not yet", with no count', async ({ page }) => {
    await openConquest(page, '/conquest?goal=OPEN_A_CELL');

    await expect(linesOf(goalOf(page, CONQUEST_PARTWAY.full_name))).toHaveText(['Reached Nov 2025']);
    await expect(linesOf(goalOf(page, CONQUEST_NONE.full_name))).toHaveText(['Not yet']);
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

  test('on a phone lists each person with the tab’s goal beside the name', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openConquest(page);

    const item = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: CONQUEST_PARTWAY.full_name }) });
    await expect(item).toBeVisible();
    // A screen reader is told which goal the figure is.
    await expect(item).toHaveText(`${CONQUEST_PARTWAY.full_name}Win 3: Reached Mar 20262 of 3 now`);
    await expect(item).not.toContainText('of 4');

    // The four tabs two by two.
    const tabs = page.getByRole('navigation', { name: 'Which goal' }).getByRole('link');
    const ys = await Promise.all((await tabs.all()).map(async (tab) => Math.round((await tab.boundingBox())!.y)));
    expect(ys[0]).toBe(ys[1]);
    expect(ys[2]).toBe(ys[3]);
    expect(ys[2]).toBeGreaterThan(ys[0]);
  });

  // One row of four from a laptop (decision 0489).
  test('sets the four tabs on one row at 1024px', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await openConquest(page);

    const tabs = page.getByRole('navigation', { name: 'Which goal' }).getByRole('link');
    const ys = await Promise.all((await tabs.all()).map(async (tab) => Math.round((await tab.boundingBox())!.y)));
    expect(new Set(ys).size).toBe(1);
  });
});
