import { expect, test, type Page } from '@playwright/test';

import {
  mockAdministrator,
  mockAwaitingReassignment,
  mockPeople,
  mockPeopleWithoutACell,
  mockScreens,
  mockSignedIn,
} from './mock-api';
import { mockCells } from './mock-attendance';

/**
 * *Awaiting CG Assignment* on `Cells` and *Awaiting Leader Assignment* on `People` (SKILL.md
 * sections 15, 17 and 19; decision 0381), moved from `Record`, which is for recording. Each keeps
 * its count, its fifty at a time and the person's page its names open. Names are invented
 * (CLAUDE.md, Secrets).
 */

/** 10:00 on 20 June 2026 in Manila. */
const JUNE_20 = new Date('2026-06-20T02:00:00Z');

async function arrange(page: Page) {
  await page.clock.setFixedTime(JUNE_20);
  await mockSignedIn(page);
  await mockCells(page);
  await mockPeople(page);
  await mockPeopleWithoutACell(page);
  await mockAwaitingReassignment(page);
}

const cellTabs = (page: Page) => page.getByRole('group', { name: 'Which Cells' });
const peopleTabs = (page: Page) => page.getByRole('navigation', { name: 'People' });

/** A list over two pages: the first carries a cursor, the second does not. */
async function mockTwoPages(page: Page, pattern: string, first: unknown[], second: unknown[]) {
  const cursors: (string | null)[] = [];
  await page.route(pattern, (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    cursors.push(cursor);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        cursor === 'page-two'
          ? { data: second, next_cursor: null }
          : { data: first, next_cursor: 'page-two' },
      ),
    });
  });
  return cursors;
}

async function mockEmpty(page: Page, pattern: string) {
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], next_cursor: null }),
    }),
  );
}

const person = (n: number, name: string) => ({
  id: `3f1b7c6e-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`,
  member_id: `M-0019${String(n).padStart(2, '0')}`,
  full_name: name,
});
const FORMER = {
  person_id: '3f1b7c6e-0000-4000-8000-000000000903',
  member_id: 'M-001003',
  full_name: 'Rogelio Mendoza',
};

test.describe('Awaiting CG Assignment, a tab of Cells (decision 0381)', () => {
  test('sits after Active Cells with its count, and lists who is in no Cell', async ({ page }) => {
    await arrange(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/cells');

    const tabs = cellTabs(page).getByRole('button');
    await expect(tabs.nth(0)).toHaveText('Active Cells');
    await expect(tabs.nth(1)).toHaveText(/^Awaiting CG Assignment\s*2$/);

    await tabs.nth(1).click();
    await expect(page).toHaveURL(/[?&]view=NOCELL/);
    await expect(tabs.nth(1)).toHaveAttribute('aria-pressed', 'true');
    const table = page.getByRole('table', { name: 'Awaiting CG Assignment' });
    await expect(table.getByRole('columnheader')).toHaveText(['Name']);
    await expect(table.getByRole('link', { name: 'Bituin Carreon' })).toHaveAttribute(
      'href',
      '/people/3f1b7c6e-0000-4000-8000-000000000921',
    );
    await expect(page.getByText('People you oversee who are not in a Cell or leading one.')).toBeVisible();
    // The Cells list's own controls belong to the other tabs.
    await expect(page.getByLabel('Search by Cell ID or leader')).toHaveCount(0);
  });

  test('Show more reads the next page in place, and the count follows', async ({ page }) => {
    await arrange(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    const cursors = await mockTwoPages(
      page,
      '**/api/v1/cells/people-without-a-cell*',
      [person(11, 'Bituin Carreon'), person(12, 'Rodolfo Villamor')],
      [person(13, 'Soledad Aquino')],
    );
    await page.goto('/cells?view=NOCELL');

    await expect(cellTabs(page).getByRole('button', { name: /^Awaiting CG Assignment\s*2\+$/ })).toBeVisible();
    const table = page.getByRole('table', { name: 'Awaiting CG Assignment' });
    await expect(table.getByRole('link')).toHaveCount(2);
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(table.getByRole('link', { name: 'Soledad Aquino' })).toBeVisible();
    expect(cursors).toContain('page-two');
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
    await expect(cellTabs(page).getByRole('button', { name: /^Awaiting CG Assignment\s*3$/ })).toBeVisible();
  });

  test('an empty list keeps its table, says so in one row, and its tab shows no count', async ({
    page,
  }) => {
    await arrange(page);
    await mockEmpty(page, '**/api/v1/cells/people-without-a-cell*');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/cells?view=NOCELL');

    await expect(cellTabs(page).getByRole('button', { name: /^Awaiting CG Assignment$/ })).toBeVisible();
    const table = page.getByRole('table', { name: 'Awaiting CG Assignment' });
    await expect(table.getByRole('cell')).toHaveText(['Everybody you oversee is in a Cell.']);

    // Below lg the same sentence stands in for the cards.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(table).toBeHidden();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Everybody you oversee is in a Cell.' }),
    ).toBeVisible();
  });

  test('the Admin has it too, after Active Cells', async ({ page }) => {
    await arrange(page);
    await mockAdministrator(page);
    await page.goto('/cells');

    await expect(cellTabs(page).getByRole('button').nth(1)).toHaveText(/^Awaiting CG Assignment/);
  });
});

test.describe('Awaiting Leader Assignment, a tab of People (decision 0381)', () => {
  test('sits between Add People and Family Tree with its count, and lists who needs a leader', async ({
    page,
  }) => {
    await arrange(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/people');

    await expect(peopleTabs(page).getByRole('link')).toHaveText([
      'Add People',
      /^Awaiting Leader Assignment\s*2$/,
      'Family Tree',
      'Absent 3+ Months',
    ]);
    await peopleTabs(page).getByRole('link', { name: /^Awaiting Leader Assignment/ }).click();
    await expect(page).toHaveURL(/\/people\/awaiting-leader$/);
    await expect(
      peopleTabs(page).getByRole('link', { name: /^Awaiting Leader Assignment/ }),
    ).toHaveAttribute('aria-current', 'page');

    const table = page.getByRole('table', { name: 'Awaiting Leader Assignment' });
    await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Previous Cell Leader']);
    await expect(
      table.getByRole('row').filter({ hasText: 'Amihan Bacani' }).getByRole('cell'),
    ).toHaveText(['Amihan Bacani', 'Rogelio Mendoza']);
    // The action that resolves an entry is the reassignment (section 19), on the person page.
    await expect(table.getByRole('link', { name: 'Amihan Bacani' })).toHaveAttribute(
      'href',
      '/people/3f1b7c6e-0000-4000-8000-000000000901',
    );
  });

  test('Show more reads the next page in place, and the count follows', async ({ page }) => {
    await arrange(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    const cursors = await mockTwoPages(
      page,
      '**/api/v1/people/awaiting-reassignment*',
      [
        { ...person(1, 'Amihan Bacani'), former_leader: FORMER },
        { ...person(2, 'Teodoro Cruz'), former_leader: FORMER },
      ],
      [{ ...person(3, 'Zenaida Flores'), former_leader: FORMER }],
    );
    await page.goto('/people/awaiting-leader');

    await expect(peopleTabs(page).getByRole('link', { name: /^Awaiting Leader Assignment\s*2\+$/ })).toBeVisible();
    const table = page.getByRole('table', { name: 'Awaiting Leader Assignment' });
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(table.getByRole('link', { name: 'Zenaida Flores' })).toBeVisible();
    expect(cursors).toContain('page-two');
    await expect(peopleTabs(page).getByRole('link', { name: /^Awaiting Leader Assignment\s*3$/ })).toBeVisible();
  });

  test('an empty list keeps its table and says so in one row', async ({ page }) => {
    await arrange(page);
    await mockEmpty(page, '**/api/v1/people/awaiting-reassignment*');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/people/awaiting-leader');

    await expect(peopleTabs(page).getByRole('link', { name: /^Awaiting Leader Assignment$/ })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Awaiting Leader Assignment' }).getByRole('cell')).toHaveText([
      'Nobody you oversee is waiting for a new leader.',
    ]);
  });
});

test.describe('where the two lists are offered (decision 0381)', () => {
  test('Record no longer carries either, and its old addresses open them where they are', async ({
    page,
  }) => {
    await arrange(page);
    await page.goto('/dashboard?list=nocell');
    await expect(page).toHaveURL(/\/cells\?view=NOCELL$/);
    await expect(page.getByRole('table', { name: 'Awaiting CG Assignment' })).toBeAttached();

    await page.goto('/dashboard?list=leader');
    await expect(page).toHaveURL(/\/people\/awaiting-leader$/);
    await expect(page.getByRole('table', { name: 'Awaiting Leader Assignment' })).toBeAttached();
  });

  test('the recording screens have neither tab', async ({ page }) => {
    await arrange(page);
    await mockScreens(page, 'RECORDING');
    const asked: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/people/awaiting-reassignment') || url.includes('/people-without-a-cell')) {
        asked.push(url);
      }
    });
    await page.goto('/people');

    await expect(peopleTabs(page).getByRole('link')).toHaveText(['Add People']);
    expect(asked).toEqual([]);
  });

  test('a phone scrolls nothing sideways on either', async ({ page }) => {
    await arrange(page);
    await page.setViewportSize({ width: 320, height: 700 });
    for (const address of ['/cells?view=NOCELL', '/people/awaiting-leader']) {
      await page.goto(address);
      await expect(page.getByRole('listitem').first()).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${address} scrolls sideways at 320px`,
      ).toBe(true);
    }
  });
});
