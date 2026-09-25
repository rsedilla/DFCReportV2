import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockSignedIn, mockWholeChurchReader } from './mock-api';
import { mockDccReport, mockDccTwelve, TWELVE } from './mock-attendance';

/**
 * DCC: Weekly, Monthly, Quarterly and Year, each opening on My 12 (SKILL.md sections 9, 13,
 * 19 and 20; decision 0294).
 *
 * `api/test/api/reporting-dcc-twelve.e2e.spec.ts` pins the figures and who may read them.
 * This pins what the screen does with them: which period it asks for, the coverage line and
 * the Sundays under it, the table with the reader alone as their own row, "How often people
 * came" on Monthly only, and Year's month-by-month table.
 *
 * `my-twelve.spec.ts` pins the navigator and the table's shared behaviour on Cell Groups; the
 * two pages share those components, so this file does not repeat them.
 *
 * The clock is fixed at 10:00 on Saturday 20 June 2026 in Manila, so the current week runs
 * from Monday 15 June, the current quarter is Q2 and May's window has closed (on the 7th).
 */
const NOW = new Date('2026-06-20T02:00:00Z');
const TODAY = '2026-06-20';

/** The signed-in reader's person, as `mock-api.ts` gives it. */
const READER = '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9';

const PERIODS = [
  {
    button: 'Weekly',
    address: 'period=week',
    kind: 'WEEK',
    start: '2026-06-15',
    what: 'in the week',
  },
  {
    button: 'Monthly',
    address: 'month=2026-06-01',
    kind: 'MONTH',
    start: '2026-06-01',
    what: 'in the month',
  },
  {
    button: 'Quarterly',
    address: 'period=quarter',
    kind: 'QUARTER',
    start: '2026-04-01',
    what: 'in the quarter',
  },
  {
    button: 'Year',
    address: 'period=year',
    kind: 'YEAR',
    start: '2026-01-01',
    what: 'in the year',
  },
] as const;

async function arrange(page: Page, options: { expectPeriod?: string; today?: string } = {}) {
  await page.clock.setFixedTime(NOW);
  await mockSignedIn(page);
  // Year's month-by-month table reads the monthly report once per month begun.
  await mockDccReport(page);
  return mockDccTwelve(page, { today: TODAY, ...options });
}

/** That the screen asked a query carrying these parameters, at any point. */
async function expectAsked(asked: URLSearchParams[], expected: Record<string, string | null>) {
  await expect
    .poll(() =>
      asked.some((query) =>
        Object.entries(expected).every(([key, value]) => query.get(key) === value),
      ),
    )
    .toBe(true);
}

const periodGroup = (page: Page) => page.getByRole('group', { name: 'Report period' });
const twelveTable = (page: Page) =>
  page
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { name: /^(Leader|Network)$/ }) });
const coverageLine = (page: Page) =>
  page.locator('main p').filter({ hasText: /^\d+ of \d+ records filed/ });
const sundaysLine = (page: Page) =>
  page.locator('main p').filter({ hasText: /^\d+ Sundays? counted/ });

/** A body row's cell texts, trimmed. */
async function cellsOf(row: Locator): Promise<string[]> {
  return (await row.getByRole('cell').allTextContents()).map((text) => text.trim());
}

test.describe('the four periods (decision 0294)', () => {
  test('opens on Monthly, and each button asks DCC’s My 12 for its own period', async ({
    page,
  }) => {
    const asked = await arrange(page);
    await page.goto('/reports/dcc');

    const group = periodGroup(page);
    await expect(group.getByRole('button')).toHaveText(['Weekly', 'Monthly', 'Quarterly', 'Year']);
    await expect(group.getByRole('button', { name: 'Monthly' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectAsked(asked, {
      kind: 'MONTH',
      start: '2026-06-01',
      period: '2026-06-01',
      scope: 'LEADER',
      leader_id: READER,
    });

    for (const each of [PERIODS[3], PERIODS[2], PERIODS[0], PERIODS[1]]) {
      await group.getByRole('button', { name: each.button }).click();
      if (each.kind === 'MONTH') {
        await expect(page).toHaveURL(/\/reports\/dcc$/);
      } else {
        await expect(page).toHaveURL(new RegExp(`[?&]${each.address}`));
      }
      await expect(group.getByRole('button', { name: each.button })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expectAsked(asked, { kind: each.kind, start: each.start, period: '2026-06-01' });
    }
  });

  test('a closed period is read as of its last month, and one not begun opens the current one', async ({
    page,
  }) => {
    const asked = await arrange(page);

    await page.goto('/reports/dcc?period=quarter&start=2026-01-01');
    await expectAsked(asked, { kind: 'QUARTER', start: '2026-01-01', period: '2026-03-01' });

    await page.goto('/reports/dcc?month=2026-05-01');
    await expectAsked(asked, { kind: 'MONTH', start: '2026-05-01', period: '2026-05-01' });

    await page.goto('/reports/dcc?period=year&start=2025-01-01');
    await expectAsked(asked, { kind: 'YEAR', start: '2025-01-01', period: '2025-12-01' });

    await page.goto('/reports/dcc?month=2026-07-01');
    await expect(page.locator('main').getByText('June 2026', { exact: true })).toBeVisible();

    expect(
      asked.every((query) => query.get('start')! <= TODAY),
      'a period that has not begun was asked for',
    ).toBe(true);
  });
});

test.describe('the coverage line and the Sundays under it', () => {
  for (const each of PERIODS) {
    test(`${each.button}: one line, linking to Filed reports on Monthly alone`, async ({
      page,
    }) => {
      await arrange(page);
      await page.goto(`/reports/dcc?${each.address}`);

      await expect(coverageLine(page)).toHaveText(
        `12 of 18 records filed ${each.what}${each.kind === 'MONTH' ? ' · see Filed reports' : ''}`,
      );
      if (each.kind === 'MONTH') {
        await expect(page.getByRole('link', { name: 'see Filed reports' })).toHaveAttribute(
          'href',
          '/reports/filed?month=2026-06-01&kind=dcc',
        );
      } else {
        await expect(page.getByRole('link', { name: 'see Filed reports' })).toHaveCount(0);
      }

      // The coverage line leads: it sits above the table.
      const heading = page.getByRole('heading', { name: /^My 12 · / });
      const [line, table] = await Promise.all([
        coverageLine(page).boundingBox(),
        heading.boundingBox(),
      ]);
      expect(line!.y, 'the coverage line sits above My 12').toBeLessThan(table!.y);
    });
  }

  test('names the Sundays counted, and any Sunday that had no service', async ({ page }) => {
    await arrange(page);

    await page.goto('/reports/dcc');
    await expect(sundaysLine(page)).toHaveText('3 Sundays counted · no service on Sunday 14 June');

    await page.goto('/reports/dcc?period=week');
    await expect(sundaysLine(page)).toHaveText('1 Sunday counted');

    // The week whose only Sunday was removed counts none, and says why.
    await page.goto('/reports/dcc?period=week&start=2026-06-08');
    await expect(sundaysLine(page)).toHaveText('0 Sundays counted · no service on Sunday 14 June');
  });

  test('a leader opened carries into Filed reports, By leader', async ({ page }) => {
    await arrange(page);
    await page.goto(`/reports/dcc?month=2026-06-01&leader=${TWELVE.consuelo.id}`);

    await expect(coverageLine(page)).toHaveText(
      '2 of 3 records filed in the month · see Filed reports',
    );
    await expect(page.getByRole('link', { name: 'see Filed reports' })).toHaveAttribute(
      'href',
      `/reports/filed?month=2026-06-01&kind=dcc&leader=${TWELVE.consuelo.id}&by=leader`,
    );
  });
});

test.describe('My 12 on DCC', () => {
  test('lists the reader’s 12, then You, alone, then Elsewhere and the Total', async ({ page }) => {
    await arrange(page);
    await page.goto('/reports/dcc');

    await expect(
      page.getByText('Who came to DCC, and where they are in their journey.'),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'My 12 · where people are in their journey' }),
    ).toBeVisible();
    await expect(
      page.locator('main p').filter({ hasText: /^Different people who came/ }),
    ).toHaveText(
      'Different people who came to DCC in the month, once each, at the stage they had reached by its last day, or so far while it is open. Open a name to see their 12.',
    );

    const table = twelveTable(page);
    await expect(table.getByRole('columnheader')).toHaveText([
      'Leader',
      'VIP',
      '2nd timer',
      '3rd timer',
      '4th timer',
      'Regular',
      'People',
    ]);
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(6);

    for (const [index, leader] of [TWELVE.teresita, TWELVE.consuelo, TWELVE.efren].entries()) {
      await expect(rows.nth(index).getByRole('cell').first()).toHaveText(leader.full_name);
      await expect(rows.nth(index).getByRole('link', { name: leader.full_name })).toHaveAttribute(
        'href',
        `/reports/dcc?month=2026-06-01&leader=${leader.id}`,
      );
    }
    // The reader alone, labelled "You" with no Cell count: nobody records their own DCC.
    expect(await cellsOf(rows.nth(3))).toEqual(['You', '0', '1', '0', '0', '0', '1']);
    expect(await cellsOf(rows.nth(4))).toEqual(['Elsewhere in this branch', '+2']);
    expect(await cellsOf(rows.nth(5))).toEqual(['Total', '3', '2', '1', '1', '3', '10']);
    await expect(table.getByText('Counted in more than one row', { exact: true })).toHaveCount(0);
    await expect(table.getByText(/Cell group|no Cell of/)).toHaveCount(0);

    // The People column adds up in plain sight (section 20): 3 + 4 + 0 + 1 + 2 = 10.
    const people = await Promise.all(
      [0, 1, 2, 3].map(async (index) => Number((await cellsOf(rows.nth(index))).at(-1))),
    );
    expect(people.reduce((sum, count) => sum + count, 0) + 2).toBe(10);

    await expect(table).not.toContainText('%');
  });

  test('opening a name shows that leader’s 12, with their own row named and its zeros shown', async ({
    page,
  }) => {
    const asked = await arrange(page);
    await page.goto('/reports/dcc');

    await twelveTable(page).getByRole('link', { name: TWELVE.consuelo.full_name }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]leader=${TWELVE.consuelo.id}`));
    await expectAsked(asked, { scope: 'LEADER', leader_id: TWELVE.consuelo.id });

    await expect(
      page.getByRole('heading', {
        name: 'Consuelo Bautista’s 12 · where people are in their journey',
      }),
    ).toBeVisible();
    const rows = twelveTable(page).locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).getByRole('link', { name: TWELVE.lourdes.full_name })).toHaveAttribute(
      'href',
      `/reports/dcc?month=2026-06-01&leader=${TWELVE.lourdes.id}`,
    );
    // She did not come, and the row says 0 rather than leaving the numbers out.
    expect(await cellsOf(rows.nth(1))).toEqual(['Consuelo Bautista', '0', '0', '0', '0', '0', '0']);
    expect(await cellsOf(rows.nth(2))).toEqual(['Total', '1', '1', '0', '1', '1', '4']);
    await expect(page.getByRole('link', { name: 'Back to your report' })).toHaveAttribute(
      'href',
      '/reports/dcc?month=2026-06-01',
    );
  });

  test('a name opens the same period it was read in', async ({ page }) => {
    await arrange(page);
    await page.goto('/reports/dcc?period=week&start=2026-06-08');

    await expect(
      twelveTable(page).getByRole('link', { name: TWELVE.efren.full_name }),
    ).toHaveAttribute(
      'href',
      `/reports/dcc?period=week&start=2026-06-08&leader=${TWELVE.efren.id}`,
    );
  });

  test('a whole-church reader’s rows are the two Networks, with no row of their own', async ({
    page,
  }) => {
    const asked = await arrange(page);
    await mockWholeChurchReader(page);
    await page.goto('/reports/dcc');

    await expectAsked(asked, { scope: 'WHOLE_CHURCH', leader_id: null });
    await expect(page.getByRole('heading', { name: /^The Networks · / })).toBeVisible();
    const table = twelveTable(page);
    await expect(table.getByRole('columnheader').first()).toHaveText('Network');
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0).getByRole('link', { name: "Men's Network" })).toHaveAttribute(
      'href',
      `/reports/dcc?month=2026-06-01&leader=${TWELVE.bonifacio.id}`,
    );
    await expect(rows.nth(1).getByRole('link', { name: "Women's Network" })).toHaveAttribute(
      'href',
      `/reports/dcc?month=2026-06-01&leader=${TWELVE.aurora.id}`,
    );
    expect(await cellsOf(rows.nth(2))).toEqual(['In no row', '+1']);
    expect(await cellsOf(rows.nth(3))).toEqual(['Total', '5', '3', '1', '1', '7', '17']);
    await expect(table.getByText('You', { exact: true })).toHaveCount(0);

    const select = page.getByLabel('Figures for');
    await expect(select.locator('option')).toHaveText([
      'Everyone in your scope',
      "Men's Network",
      "Women's Network",
    ]);
    await select.selectOption({ label: "Women's Network" });
    await expect(page).toHaveURL(new RegExp(`[?&]leader=${TWELVE.aurora.id}`));
  });

  test('Figures for offers the reader’s direct 12 by name', async ({ page }) => {
    await arrange(page);
    await page.goto('/reports/dcc');

    const select = page.getByLabel('Figures for');
    await expect(select.locator('optgroup')).toHaveAttribute('label', 'Your direct 12');
    await expect(select.locator('option')).toHaveText([
      'Everyone you oversee',
      'Teresita Alcantara',
      'Consuelo Bautista',
      'Efren Dimaculangan',
    ]);
  });
});

test.describe('How often people came, and Year', () => {
  test('is shown on Monthly alone, and adds up to the same people as My 12', async ({ page }) => {
    await arrange(page);
    await page.goto('/reports/dcc');

    const often = page.getByRole('region', { name: 'How often people came' });
    await expect(often).toBeVisible();
    await expect(often.getByRole('term').last()).toHaveText('Total');
    await expect(often.getByRole('definition').last()).toHaveText('10');
    await expect(
      often.getByRole('term').filter({ hasText: '3 times — all of them' }),
    ).toBeVisible();
    await expect(
      often.getByText('3 Sundays carried a service this month.', { exact: false }),
    ).toBeVisible();

    for (const each of PERIODS.filter((period) => period.kind !== 'MONTH')) {
      await page.goto(`/reports/dcc?${each.address}`);
      await expect(page.getByRole('heading', { name: /^My 12 · / })).toBeVisible();
      await expect(page.getByRole('region', { name: 'How often people came' })).toHaveCount(0);
    }
  });

  test('Year keeps its month-by-month table beneath My 12, and no other period shows one', async ({
    page,
  }) => {
    await arrange(page);
    await page.goto('/reports/dcc?period=year');

    const months = page.getByRole('heading', { name: 'Month by month, January to June 2026' });
    await expect(months).toBeVisible();
    const twelve = page.getByRole('heading', { name: /^My 12 · / });
    const [top, bottom] = await Promise.all([twelve.boundingBox(), months.boundingBox()]);
    expect(top!.y).toBeLessThan(bottom!.y);

    for (const each of PERIODS.filter((period) => period.kind !== 'YEAR')) {
      await page.goto(`/reports/dcc?${each.address}`);
      await expect(page.getByRole('heading', { name: /^My 12 · / })).toBeVisible();
      await expect(page.getByRole('heading', { name: /^Month by month/ })).toHaveCount(0);
    }
  });
});

test.describe('what decision 0294 took off this page', () => {
  test('no Month/Year radio, no Network select, no stages frame and no Recording coverage heading', async ({
    page,
  }) => {
    await arrange(page);
    await mockWholeChurchReader(page);
    await page.goto('/reports/dcc');
    await expect(page.getByRole('heading', { name: /^The Networks · / })).toBeVisible();

    await expect(page.getByRole('radiogroup', { name: 'Report period' })).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Where people are in their journey', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recording coverage' })).toHaveCount(0);
    await expect(page.getByLabel('Figures for').locator('option[value="MENS"]')).toHaveCount(0);
  });
});

test.describe('a guard month the server disagrees with', () => {
  test('is asked again, once, with the month the refusal names', async ({ page }) => {
    // 23:59 on Tuesday 30 June 2026 in Manila; the database has already reached July.
    await page.clock.setFixedTime(new Date('2026-06-30T15:59:00Z'));
    await mockSignedIn(page);
    await mockDccReport(page);
    const asked = await mockDccTwelve(page, { today: '2026-07-01', expectPeriod: '2026-07-01' });
    await page.goto('/reports/dcc?period=week');

    await expect(page.getByRole('heading', { name: /^My 12 · / })).toBeVisible();
    await expect(page.getByText(/read as of/)).toHaveCount(0);
    const mine = asked.filter((query) => query.get('leader_id') === READER);
    expect(new Set(mine.map((query) => query.get('period')))).toEqual(
      new Set(['2026-06-01', '2026-07-01']),
    );
  });
});
