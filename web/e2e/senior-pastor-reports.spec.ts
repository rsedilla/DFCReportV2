import { expect, test, type Page } from '@playwright/test';

import { mockScreens, mockSignedIn } from './mock-api';
import { mockCellTwelve, mockDccEvents, mockDccRoster, mockDccTwelve } from './mock-attendance';
import {
  SP_MENS_ROOT,
  SP_PRIMARIES,
  SP_WOMENS_ROOT,
  mockBranchPeople,
  mockChurchCounts,
  mockRootLeadersTwelve,
  mockTrends,
} from './mock-senior-pastor';

/** An open period's note, dated (decision 0478). */
const AS_OF_TODAY = /^As of today, \d{1,2} [A-Z][a-z]{2}$/;

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

test.describe('the Senior Pastors’ four items (decision 0488)', () => {
  test('are People, Cells, Services and Conquest, with no Record or Reports, and they open on Services', async ({
    page,
  }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);
    await mockDccTwelve(page);

    await page.goto('/reports/dcc');

    const items = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
    await expect(items).toHaveText(['People', 'Cells', 'Services', 'Conquest']);
    await expect(items.nth(2)).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Services');
    // Services holds one report, so no tab is drawn.
    await expect(page.getByRole('navigation', { name: 'Which report' })).toHaveCount(0);
    await expect(page).toHaveTitle('Services – DREAMS');
  });

  test('Cells holds CG Attendance and the two Cell counts as tabs, each count named in words', async ({
    page,
  }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);

    await page.goto('/reports/number-of-cells');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cells');
    const tabs = page.getByRole('navigation', { name: 'Which report' }).getByRole('link');
    await expect(tabs).toHaveText(['CG Attendance', '# of Cell Groups', '# of Cell Leaders']);
    // A screen reader says `#` as "number sign", so each keeps its words as its name.
    for (const name of ['Number of Cell Groups', 'Number of Cell Leaders']) {
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Number of Cell Groups', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]'),
    ).toHaveText('Cells');
    // The three sit on one row on a phone too.
    await page.setViewportSize({ width: 390, height: 844 });
    const ys = await Promise.all((await tabs.all()).map(async (tab) => (await tab.boundingBox())!.y));
    expect(new Set(ys).size).toBe(1);
  });

  test('People is # of People under its own heading, with no tabs', async ({ page }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);

    await page.goto('/reports/number-of-people');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('People');
    await expect(page.getByRole('navigation', { name: 'Which report' })).toHaveCount(0);
    await expect(
      page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]'),
    ).toHaveText('People');
  });
});

test.describe('People’s Men, Women and Both (decision 0490)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  async function asRoot(page: Page, rootId: string) {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSignedIn(page);
    await mockScreens(page, 'SENIOR_PASTOR', { personId: rootId });
    return mockChurchCounts(page);
  }

  const people = (page: Page) => page.getByRole('region', { name: 'Number of people' });
  const which = (page: Page) => page.getByRole('group', { name: 'Which Network' });

  test('the Bishop opens on Men, then Women, then Both, each with its total and table', async ({ page }) => {
    const asked = await asRoot(page, SP_MENS_ROOT.id);

    await page.goto('/reports/number-of-people');

    await expect(which(page).getByRole('button')).toHaveText(['Men', 'Women', 'Both']);
    await expect(which(page).getByRole('button', { name: 'Men’s Network', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(people(page).getByRole('heading', { name: 'Men’s Network' })).toBeVisible();
    await expect(people(page).getByRole('definition').first()).toHaveText('20');
    await expect(page.getByRole('table', { name: MENS_TABLE })).toBeVisible();
    await expect(page.getByRole('table', { name: WOMENS_TABLE })).toHaveCount(0);
    await expect.poll(() => asked.includes('2026-10-01|MENS')).toBe(true);

    await which(page).getByRole('button', { name: 'Women’s Network', exact: true }).click();
    await expect(page).toHaveURL(/[?&]network=WOMENS\b/);
    await expect(people(page).getByRole('definition').first()).toHaveText('16');
    await expect(page.getByRole('table', { name: WOMENS_TABLE })).toBeVisible();
    await expect(page.getByRole('table', { name: MENS_TABLE })).toHaveCount(0);

    await which(page).getByRole('button', { name: /^Both/ }).click();
    await expect(page).toHaveURL(/[?&]network=BOTH\b/);
    // Men's 20 and Women's 16 are the whole church's 36.
    await expect(people(page).getByRole('heading', { name: 'Whole Church' })).toBeVisible();
    await expect(people(page).getByRole('definition').first()).toHaveText('36');
    await expect(page.getByRole('table', { name: MENS_TABLE })).toBeVisible();
    await expect(page.getByRole('table', { name: WOMENS_TABLE })).toBeVisible();
  });

  test('Pastora opens on Women, then Men, then Both', async ({ page }) => {
    await asRoot(page, SP_WOMENS_ROOT.id);

    await page.goto('/reports/number-of-people');

    await expect(which(page).getByRole('button')).toHaveText(['Women', 'Men', 'Both']);
    await expect(which(page).getByRole('button', { name: 'Women’s Network', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(people(page).getByRole('definition').first()).toHaveText('16');
  });

  test('a Primary’s name opens their 12 here, with the way back to People', async ({ page }) => {
    await asRoot(page, SP_MENS_ROOT.id);
    const asked = await mockBranchPeople(page);

    await page.goto('/reports/number-of-people');
    const name = page.getByRole('link', { name: SP_PRIMARIES.abad.full_name });
    await expect(name).toHaveAttribute('href', `/reports/number-of-people?leader=${SP_PRIMARIES.abad.id}`);

    await name.click();

    await expect(page).toHaveURL(new RegExp(`leader=${SP_PRIMARIES.abad.id}`));
    await expect.poll(() => asked.at(-1)?.leader).toBe(SP_PRIMARIES.abad.id);
    await expect(page.getByRole('link', { name: 'Back to People' })).toHaveAttribute(
      'href',
      '/reports/number-of-people',
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('People');
    // The other counts keep a name opening the person's page.
    await page.goto('/reports/number-of-cells');
    await expect(page.getByRole('link', { name: SP_PRIMARIES.abad.full_name })).toHaveAttribute(
      'href',
      `/people/${SP_PRIMARIES.abad.id}`,
    );
    await expect(page.getByRole('group', { name: 'Which Network' })).toHaveCount(0);
  });

  test('in a leader’s 12 a name with people beneath links a level down, and a count of one stays a name', async ({
    page,
  }) => {
    await asRoot(page, SP_MENS_ROOT.id);
    await mockBranchPeople(page);
    const solo = '3f1b7c6e-0000-4000-8000-000000000799';
    // One leader whose 12 holds somebody leading nobody, answered after the shared mock.
    await page.route(`**/api/v1/reports/people/branch?*leader_id=${solo}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          period: '2026-10-01',
          current: true,
          at: '2026-10-08T02:00:00.000Z',
          total: 2,
          own: 1,
          rows: [
            {
              leader: { id: '3f1b7c6e-0000-4000-8000-000000000798', member_id: 'M-000898', full_name: 'Teofilo Rosales' },
              people: 1,
            },
          ],
        }),
      }),
    );

    await page.goto(`/reports/number-of-people?leader=${SP_PRIMARIES.abad.id}`);
    const consuelo = page.getByRole('link', { name: 'Consuelo Bautista' });
    await expect(consuelo).toHaveAttribute(
      'href',
      '/reports/number-of-people?leader=3f1b7c6e-0000-4000-8000-000000000701',
    );
    await expect(page.getByRole('link', { name: 'Efren Dimaculangan' })).toBeVisible();

    await consuelo.click();
    await expect(page.getByRole('link', { name: 'Lourdes Magsaysay' })).toHaveAttribute(
      'href',
      '/reports/number-of-people?leader=3f1b7c6e-0000-4000-8000-000000000703',
    );

    await page.goto(`/reports/number-of-people?leader=${solo}`);
    await expect(page.getByRole('cell', { name: 'Teofilo Rosales' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Teofilo Rosales' })).toHaveCount(0);
  });

  test('a Primary’s 12 opens for the month and Network on screen, and the way back keeps both', async ({
    page,
  }) => {
    await asRoot(page, SP_MENS_ROOT.id);
    const asked = await mockBranchPeople(page);

    await page.goto('/reports/number-of-people?network=WOMENS&month=2026-09-01');
    const name = page.getByRole('link', { name: SP_PRIMARIES.bautista.full_name });
    await expect(name).toHaveAttribute(
      'href',
      `/reports/number-of-people?leader=${SP_PRIMARIES.bautista.id}&month=2026-09-01&network=WOMENS`,
    );

    await name.click();

    await expect.poll(() => asked.at(-1)).toEqual({ leader: SP_PRIMARIES.bautista.id, period: '2026-09-01' });
    await expect(page.getByRole('link', { name: 'Back to People' })).toHaveAttribute(
      'href',
      '/reports/number-of-people?month=2026-09-01&network=WOMENS',
    );
  });
});

test.describe('the three counts (decisions 0326 and 0327)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('# of Cells: Total and the four categories, a table per root headed Primaries', async ({
    page,
  }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);

    await page.goto('/reports/number-of-cells');

    const counts = page.getByRole('region', { name: 'Number of Cell Groups' });
    await expect(counts.getByRole('term')).toHaveText(['Total', 'J12 Kids', 'Youth', 'Young Pro', 'Couple']);
    // The first tile also says when it is as of (decision 0451).
    await expect(counts.getByRole('definition')).toHaveText(['5', AS_OF_TODAY, '0', '1', '3', '1']);

    const mens = page.getByRole('table', { name: MENS_TABLE });
    await expect(mens.getByRole('columnheader')).toHaveText([
      'Primaries',
      'Total',
      'J12 Kids',
      'Youth',
      'Young Pro',
      'Couple',
    ]);
    // The server's order, and each name a link in the link colour to that Primary's page (decision 0364).
    const names = mens.getByRole('link');
    await expect(names).toHaveText([SP_PRIMARIES.abad.full_name, SP_PRIMARIES.ocampo.full_name]);
    await expect(names.first()).toHaveClass(/text-accent/);
    await expect(names.first()).toHaveAttribute('href', `/people/${SP_PRIMARIES.abad.id}`);
    await expect(mens.getByRole('row').nth(1).getByRole('cell')).toHaveText([
      SP_PRIMARIES.abad.full_name,
      '2',
      '0',
      '0',
      '2',
      '0',
    ]);
    await expect(page.getByRole('table', { name: WOMENS_TABLE })).toBeVisible();
    await expect(page.getByText('Total 1 · J12 Kids 0 · Youth 0 · Young Pro 0 · Couple 1')).toBeVisible();
  });

  test('# of Cells sets its five figures on one line, and on a phone Total across the top', async ({
    page,
  }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/reports/number-of-cells');

    const tiles = page
      .getByRole('region', { name: 'Number of Cell Groups' })
      .locator('dl')
      .first()
      .locator('> div');
    await expect(tiles).toHaveCount(5);
    const boxes = async () =>
      Promise.all((await tiles.all()).map(async (tile) => (await tile.boundingBox())!));
    expect(new Set((await boxes()).map((box) => box.y)).size).toBe(1);

    // On a phone: Total alone on the first line, then the four two by two (decision 0431).
    await page.setViewportSize({ width: 390, height: 844 });
    const [total, kids, youth, youngPro, couple] = await boxes();
    expect(kids.y).toBeGreaterThan(total.y);
    expect(kids.y).toBe(youth.y);
    expect(youngPro.y).toBe(couple.y);
    expect(youngPro.y).toBeGreaterThan(kids.y);
    expect(total.width).toBeGreaterThan(kids.width * 1.5);
  });

  test('# of Cell Leaders and # of people each show their one figure', async ({ page }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);

    await page.goto('/reports/number-of-cell-leaders');
    const leaders = page.getByRole('region', { name: 'Number of Cell Leaders' });
    await expect(leaders.getByRole('term')).toHaveText(['Cell Leaders']);
    await expect(leaders.getByRole('definition')).toHaveText(['5', AS_OF_TODAY]);
    await expect(page.getByRole('table', { name: MENS_TABLE }).getByRole('columnheader')).toHaveText([
      'Primaries',
      'Cell Leaders',
    ]);

    await page.goto('/reports/number-of-people');
    const people = page.getByRole('region', { name: 'Number of people' });
    await expect(people.getByRole('term')).toHaveText(['People']);
    await expect(people.getByRole('definition')).toHaveText(['36', AS_OF_TODAY]);
  });

  test('step a month at a time with the same ‹ › control as the attendance tabs', async ({
    page,
  }) => {
    await seniorPastor(page);
    const asked = await mockChurchCounts(page);

    await page.goto('/reports/number-of-cell-leaders');

    await expect(page.getByText('October 2026', { exact: true })).toBeVisible();
    // In the first tile, not beside the month (decision 0451).
    await expect(page.getByText(AS_OF_TODAY)).toBeVisible();
    // A month that has not begun is not reported (decision 0216).
    await expect(page.getByRole('button', { name: 'The period after' })).toBeDisabled();
    // No length but the month, and no second switch for it (decision 0398).
    await expect(page.getByRole('group', { name: 'Report period' }).getByRole('button')).toHaveText([
      'Monthly',
      'Yearly',
    ]);

    await page.getByRole('button', { name: 'The period before' }).click();

    await expect(page.getByText('September 2026', { exact: true })).toBeVisible();
    await expect(page.getByText('As of 30 September 2026', { exact: true })).toBeVisible();
    await expect.poll(() => asked.at(-1)).toBe('2026-09-01');
    // The month travels to the other tabs.
    await expect(page.getByRole('link', { name: 'Number of Cell Groups', exact: true })).toHaveAttribute(
      'href',
      '/reports/number-of-cells?month=2026-09-01',
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
      // Short on screen, in full for a screen reader (decision 0460).
      '2nd2nd Timer',
      '3rd3rd Timer',
      '4th4th Timer',
      'RegRegular',
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
    // Filed Reports is withdrawn for every account (decision 0340).
    await expect(page.locator('a[href^="/reports/filed"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /How these are counted/i })).toHaveCount(0);
  });

  test('CG Attendance is a tab of Cells with no switch inside, the month and Figures for are one row, and an open month says As of today', async ({
    page,
  }) => {
    await attendance(page);

    await page.goto('/reports/cells');

    // A tab of Cells, with no attendance switch inside it (decisions 0481 and 0488), the three
    // on one row.
    const tabs = page.getByRole('navigation', { name: 'Which report' }).getByRole('link');
    await expect(tabs).toHaveText(['CG Attendance', '# of Cell Groups', '# of Cell Leaders']);
    await expect(tabs.first()).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('group', { name: 'Which attendance' })).toHaveCount(0);
    const rows = new Set(
      await Promise.all((await tabs.all()).map(async (tab) => Math.round((await tab.boundingBox())!.y))),
    );
    expect(rows.size).toBe(1);
    await expect(page.getByRole('group', { name: 'Report period' })).toBeVisible();

    const bar = page.getByLabel('Figures for').locator('xpath=../..');
    await expect(bar.getByRole('button', { name: 'The period before' })).toBeVisible();
    // Two words, once "so far" (decision 0451).
    // Beside the month from `lg`; a phone says it under the bar instead.
    await expect(bar.getByText(AS_OF_TODAY).first()).toBeVisible();
    await expect(page.getByText(/^Open until /)).toHaveCount(0);

    // # of Cell Groups opens its count and is the tab marked current.
    await tabs.nth(1).click();
    await expect(page).toHaveURL(/\/reports\/number-of-cells/);
    await expect(tabs.nth(1)).toHaveAttribute('aria-current', 'page');
  });

  // Figures for is three buttons, and a Primary opens by their name (decision 0486).
  test('Figures for is All, Men’s and Women’s, with no list of names, on both Attendance tabs (decision 0486)', async ({
    page,
  }) => {
    await attendance(page);

    for (const path of ['/reports/cells', '/reports/dcc']) {
      await page.goto(path);
      const figuresFor = page.getByRole('group', { name: 'Figures for' });
      await expect(figuresFor.getByRole('button')).toHaveText(['All', 'Men’s', 'Women’s']);
      await expect(figuresFor.getByRole('button', { name: 'All, the whole church' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByRole('combobox', { name: 'Figures for' })).toHaveCount(0);

      await figuresFor.getByRole('button', { name: 'Men’s Network', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}\\?network=MENS$`));
      await expect(figuresFor.getByRole('button', { name: 'Men’s Network', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await figuresFor.getByRole('button', { name: 'All, the whole church' }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
  });

  test('on a phone a Primary’s name is short, and the link is named short then full (decision 0451)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await attendance(page);

    await page.goto('/reports/cells');

    const mens = page.getByRole('table', { name: MENS_TABLE });
    const link = mens.getByRole('link', { name: 'Bernardo A., Bernardo Abad' });
    await expect(link).toHaveText('Bernardo A.');
    // Every figure in view: the table does not scroll sideways.
    const overflow = await mens.evaluate((table) => {
      const frame = table.parentElement!;
      return frame.scrollWidth - frame.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('DCC attendance shows no records filed and no Sundays counted', async ({ page }) => {
    await attendance(page);

    await page.goto('/reports/dcc');

    await expect(page.getByRole('table', { name: MENS_TABLE })).toBeVisible();
    await expect(page.getByText(/records filed/)).toHaveCount(0);
    await expect(page.getByText(/Sundays? counted/)).toHaveCount(0);
  });

});

test('Reports switches a figure between Monthly and its last 12 months on one switch, keeping the tab (decisions 0377 and 0398)', async ({
  page,
}) => {
  await seniorPastor(page);
  await mockChurchCounts(page);
  await mockTrends(page);

  await page.goto('/reports/number-of-cell-leaders');
  // No second row: the lengths and the twelve months are one switch (decision 0398).
  await expect(page.getByRole('group', { name: 'Which view' })).toHaveCount(0);
  const view = page.getByRole('group', { name: 'Report period' });
  await expect(view.getByRole('button')).toHaveText(['Monthly', 'Yearly']);
  await expect(view.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true');

  await view.getByRole('button', { name: 'Yearly' }).click();
  await expect(page).toHaveURL(/\/trends\?figure=CELL_LEADERS$/);
  await expect(page.getByRole('heading', { name: 'Cells', level: 1 })).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Which report' });
  await expect(tabs.locator('a[aria-current="page"]')).toHaveText('# of Cell Leaders');
  // The sidebar marks Cells, which holds the figure; there is no Trends item (decision 0488).
  const main = page.getByRole('navigation', { name: 'Main' });
  await expect(main.getByRole('link')).toHaveText(['People', 'Cells', 'Services', 'Conquest']);
  await expect(main.locator('a[aria-current="page"]')).toHaveText('Cells');

  const back = page.getByRole('group', { name: 'Report period' });
  await expect(back.getByRole('button', { name: 'Yearly' })).toHaveAttribute('aria-pressed', 'true');
  // The twelve months have no month to step.
  await expect(page.getByRole('button', { name: 'The period before' })).toHaveCount(0);
  await back.getByRole('button', { name: 'Monthly' }).click();
  await expect(page).toHaveURL(/\/reports\/number-of-cell-leaders$/);
});

test('the Senior Pastors’ attendance switch is Monthly and Yearly, and a length chosen on Yearly opens the tab by it (decisions 0398, 0443 and 0485)', async ({
  page,
}) => {
  await seniorPastor(page);
  await mockCellTwelve(page);
  await mockRootLeadersTwelve(page);
  await mockChurchCounts(page);
  await mockTrends(page);

  await page.goto('/reports/cells');
  const view = page.getByRole('group', { name: 'Report period' });
  await expect(view.getByRole('button')).toHaveText(['Monthly', 'Yearly']);
  await expect(view.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true');

  await view.getByRole('button', { name: 'Yearly' }).click();
  await expect(page).toHaveURL(/\/trends(\?figure=CG)?$/);
  await page.getByRole('group', { name: 'Report period' }).getByRole('button', { name: 'Monthly' }).click();
  await expect(page).toHaveURL(/\/reports\/cells$/);
});

// A week address kept from before opens the month for them, as a quarter's does (decision 0485).
test('a week address opens the month for the Senior Pastors, on both Attendance tabs (decision 0485)', async ({
  page,
}) => {
  await seniorPastor(page);
  await mockCellTwelve(page);
  await mockRootLeadersTwelve(page);
  await mockDccTwelve(page);

  for (const path of ['/reports/cells', '/reports/dcc']) {
    await page.goto(`${path}?period=week`);
    const view = page.getByRole('group', { name: 'Report period' });
    await expect(view.getByRole('button')).toHaveText(['Monthly', 'Yearly']);
    await expect(view.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true');
  }
});

test.describe('one size for every report control (decision 0398)', () => {
  for (const width of [1280, 360]) {
    test(`at ${width}px every switch button is one width and none wraps its words`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await seniorPastor(page);
      await mockCellTwelve(page);
      await mockRootLeadersTwelve(page);

      await page.goto('/reports/cells');
      const buttons = page.getByRole('group', { name: 'Report period' }).getByRole('button');
      // Monthly and Yearly: the Senior Pastors have no Weekly (decision 0485).
      await expect(buttons).toHaveCount(2);
      const boxes = await buttons.evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return { width: Math.round(box.width), height: Math.round(box.height) };
        }),
      );
      // One size (decision 0416): within a pixel, a row's leftover pixel falling to one column.
      expect(Math.max(...boxes.map((box) => box.width)) - Math.min(...boxes.map((box) => box.width))).toBeLessThanOrEqual(1);
      for (const box of boxes) {
        // 44px tall: one line of words, and the target size (2.5.8).
        expect(box.height).toBe(44);
      }
    });
  }
});

test.describe('Trends (decisions 0326 and 0327)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  const graph = (page: Page) => page.getByRole('img', { name: /, November 2025 to October 2026: / });

  test('has the same tabs as the item it is under, keeping the leader chosen (decision 0488)', async ({ page }) => {
    await seniorPastor(page);
    await mockChurchCounts(page);
    const asked = await mockTrends(page);

    await page.goto(`/trends?leader=${SP_PRIMARIES.abad.id}`);

    // CG Attendance's twelve months are under Cells, with its three tabs (decision 0488).
    const tabs = page.getByRole('navigation', { name: 'Which report' }).getByRole('link');
    await expect(tabs).toHaveText(['CG Attendance', '# of Cell Groups', '# of Cell Leaders']);
    await expect(
      page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]'),
    ).toHaveText('Cells');
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
      `${SP_WOMENS_ROOT.full_name} · Women’s`,
      `${SP_MENS_ROOT.full_name} · Men’s`,
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
      await expect(page.getByRole('link', { name: 'Number of Cell Groups', exact: true })).toBeVisible();
      if (route === '/trends') {
        await expect(page.getByRole('checkbox', { name: 'Whole Church' })).toBeVisible();
      } else {
        await expect(page.getByRole('region', { name: 'Number of Cell Groups' }).getByRole('term').first()).toBeVisible();
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
