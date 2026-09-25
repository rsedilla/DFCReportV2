import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockSignedIn, mockWholeChurchReader } from './mock-api';
import { mockCellReport, mockCellTwelve, TWELVE } from './mock-attendance';

/**
 * Cell Groups: Weekly, Monthly, Quarterly and Year, each opening on My 12 (SKILL.md sections
 * 12, 13 and 20; decision 0293).
 *
 * `api/test/api/reporting-cells-twelve.e2e.spec.ts` pins the figures and who may read them.
 * This pins what the screen does with them: which period it asks for, what the address
 * holds, where the navigator stops, and that the table keeps section 13's four conditions --
 * surname order as the API sends it, no row numbers, each name opening that leader's 12, and
 * the People column adding up in plain sight.
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
    label: '15 Jun – 21 Jun 2026',
    what: 'in the week',
  },
  {
    button: 'Monthly',
    address: 'month=2026-06-01',
    kind: 'MONTH',
    start: '2026-06-01',
    label: 'June 2026',
    what: 'in the month',
  },
  {
    button: 'Quarterly',
    address: 'period=quarter',
    kind: 'QUARTER',
    start: '2026-04-01',
    label: 'Q2 2026 · Apr–Jun',
    what: 'in the quarter',
  },
  {
    button: 'Year',
    address: 'period=year',
    kind: 'YEAR',
    start: '2026-01-01',
    label: '2026',
    what: 'in the year',
  },
] as const;

/** Each period's previous one, which the navigator's ‹ opens. */
const BEFORE = {
  WEEK: { label: '8 Jun – 14 Jun 2026', start: '2026-06-08', period: '2026-06-01', open: true },
  MONTH: { label: 'May 2026', start: '2026-05-01', period: '2026-05-01', open: false },
  QUARTER: { label: 'Q1 2026 · Jan–Mar', start: '2026-01-01', period: '2026-03-01', open: false },
  YEAR: { label: '2025', start: '2025-01-01', period: '2025-12-01', open: false },
} as const;

async function arrange(page: Page, options: { ownCells?: number } = {}) {
  await page.clock.setFixedTime(NOW);
  await mockSignedIn(page);
  // Year's month-by-month table reads the monthly report once per month begun.
  await mockCellReport(page);
  return mockCellTwelve(page, { today: TODAY, ...options });
}

/**
 * That the screen asked a query carrying these parameters. **Any query, not the last**: a
 * period the screen has already read is served from its cache and asks nothing again, so
 * "the last request" would name a period the screen has since left.
 */
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
const periodLabel = (page: Page, label: string) =>
  page.locator('main').getByText(label, { exact: true });
const twelveTable = (page: Page) =>
  page
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { name: 'Leader', exact: true }) });

/** A body row's cell texts, trimmed. */
async function cellsOf(row: Locator): Promise<string[]> {
  return (await row.getByRole('cell').allTextContents()).map((text) => text.trim());
}

test.describe('the four periods (decision 0293)', () => {
  test('opens on Monthly, and each button asks for its own period and keeps it in the address', async ({
    page,
  }) => {
    const asked = await arrange(page);
    await page.goto('/reports/cells');

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

    // Switching length always opens the current period, so Monthly's address names no month
    // and no period at all.
    for (const each of [PERIODS[3], PERIODS[2], PERIODS[0], PERIODS[1]]) {
      await group.getByRole('button', { name: each.button }).click();
      if (each.kind === 'MONTH') {
        await expect(page).toHaveURL(/\/reports\/cells$/);
      } else {
        await expect(page).toHaveURL(new RegExp(`[?&]${each.address}`));
      }
      for (const other of PERIODS) {
        await expect(group.getByRole('button', { name: other.button })).toHaveAttribute(
          'aria-pressed',
          String(other === each),
        );
      }
      await expect(periodLabel(page, each.label)).toBeVisible();
      // Every period running today is read as of the current month (the guard's month).
      await expectAsked(asked, { kind: each.kind, start: each.start, period: '2026-06-01' });
    }

    // Monthly is addressed by `month` alone, as the other reports address it.
    await expect(page).not.toHaveURL(/[?&]period=/);
  });

  test('an address opens the period it names, and a reload keeps it', async ({ page }) => {
    const asked = await arrange(page);

    await page.goto('/reports/cells?period=week&start=2026-06-08');
    await expect(periodLabel(page, '8 Jun – 14 Jun 2026')).toBeVisible();
    await expect(periodGroup(page).getByRole('button', { name: 'Weekly' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectAsked(asked, { kind: 'WEEK', start: '2026-06-08', period: '2026-06-01' });
    await page.reload();
    await expect(periodLabel(page, '8 Jun – 14 Jun 2026')).toBeVisible();

    // A week named by a Wednesday opens the week holding it.
    await page.goto('/reports/cells?period=week&start=2026-06-10');
    await expect(periodLabel(page, '8 Jun – 14 Jun 2026')).toBeVisible();
    await expectAsked(asked, { kind: 'WEEK', start: '2026-06-08' });

    // A closed quarter is read as of its last month.
    await page.goto('/reports/cells?period=quarter&start=2026-01-01');
    await expect(periodLabel(page, 'Q1 2026 · Jan–Mar')).toBeVisible();
    await expectAsked(asked, { kind: 'QUARTER', start: '2026-01-01', period: '2026-03-01' });

    await page.goto('/reports/cells?period=year&start=2025-01-01');
    await expect(periodLabel(page, '2025')).toBeVisible();
    await expectAsked(asked, { kind: 'YEAR', start: '2025-01-01', period: '2025-12-01' });

    await page.goto('/reports/cells?month=2026-05-01');
    await expect(periodLabel(page, 'May 2026')).toBeVisible();
    await expectAsked(asked, { kind: 'MONTH', start: '2026-05-01', period: '2026-05-01' });

    // A period that has not begun is not reported (decision 0216): the current one opens.
    await page.goto('/reports/cells?period=quarter&start=2026-07-01');
    await expect(periodLabel(page, 'Q2 2026 · Apr–Jun')).toBeVisible();
    await page.goto('/reports/cells?period=week&start=2026-06-29');
    await expect(periodLabel(page, '15 Jun – 21 Jun 2026')).toBeVisible();

    expect(
      asked.every((query) => query.get('start')! <= TODAY),
      'a period that has not begun was asked for',
    ).toBe(true);
  });

  test('Back steps back through the period, the length and the leader', async ({ page }) => {
    await arrange(page);
    await page.goto('/reports/cells');
    await expect(periodLabel(page, 'June 2026')).toBeVisible();

    await periodGroup(page).getByRole('button', { name: 'Weekly' }).click();
    await expect(periodLabel(page, '15 Jun – 21 Jun 2026')).toBeVisible();
    await page.getByRole('button', { name: 'The period before' }).click();
    await expect(page).toHaveURL(/[?&]start=2026-06-08/);
    await page.getByLabel('Figures for').selectOption(TWELVE.consuelo.id);
    await expect(page).toHaveURL(new RegExp(`leader=${TWELVE.consuelo.id}`));

    await page.goBack();
    await expect(page).not.toHaveURL(/leader=/);
    await expect(periodLabel(page, '8 Jun – 14 Jun 2026')).toBeVisible();
    await page.goBack();
    await expect(periodLabel(page, '15 Jun – 21 Jun 2026')).toBeVisible();
    await page.goBack();
    await expect(periodLabel(page, 'June 2026')).toBeVisible();
  });
});

test.describe('the navigator', () => {
  for (const each of PERIODS) {
    test(`${each.button}: › stops at the current period, and ‹ opens the one before`, async ({
      page,
    }) => {
      const asked = await arrange(page);
      await page.goto(`/reports/cells?${each.address}`);

      const before = page.getByRole('button', { name: 'The period before' });
      const after = page.getByRole('button', { name: 'The period after' });
      await expect(periodLabel(page, each.label)).toBeVisible();
      await expect(after).toBeDisabled();
      await expect(before).toBeEnabled();
      await expect(page.getByText('Open for submission', { exact: true }).first()).toBeVisible();

      await before.click();
      const previous = BEFORE[each.kind];
      await expect(periodLabel(page, previous.label)).toBeVisible();
      await expectAsked(asked, { kind: each.kind, start: previous.start, period: previous.period });
      await expect(after).toBeEnabled();
      await expect(
        page
          .getByText(previous.open ? 'Open for submission' : 'Closed for submission', {
            exact: true,
          })
          .first(),
      ).toBeVisible();

      await after.click();
      await expect(periodLabel(page, each.label)).toBeVisible();
      await expect(after).toBeDisabled();
    });
  }
});

test.describe('My 12', () => {
  test('lists the reader’s 12 as the API sends them, with no row numbers, then You, the two lines and the Total', async ({
    page,
  }) => {
    await arrange(page);
    await page.goto('/reports/cells');

    await expect(
      page.getByRole('heading', { name: 'My 12 · where people are in their journey' }),
    ).toBeVisible();
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
    await expect(rows).toHaveCount(7);

    // Surname order as sent, which is 3, 4, 0 by People: neither ascending nor descending.
    const names = [TWELVE.teresita, TWELVE.consuelo, TWELVE.efren];
    for (const [index, leader] of names.entries()) {
      const row = rows.nth(index);
      // No row number: the first cell is the name and nothing else.
      await expect(row.getByRole('cell').first()).toHaveText(leader.full_name);
      await expect(row.getByRole('link', { name: leader.full_name })).toHaveAttribute(
        'href',
        `/reports/cells?month=2026-06-01&leader=${leader.id}`,
      );
    }
    expect(await cellsOf(rows.nth(0))).toEqual([
      'Teresita Alcantara',
      '1',
      '0',
      '1',
      '0',
      '1',
      '3',
    ]);
    expect(await cellsOf(rows.nth(1))).toEqual(['Consuelo Bautista', '1', '1', '0', '1', '1', '4']);
    expect(await cellsOf(rows.nth(2))).toEqual([
      'Efren Dimaculangan',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
    ]);
    expect(await cellsOf(rows.nth(3))).toEqual([
      'You · your own Cell groups (2)',
      '0',
      '1',
      '0',
      '0',
      '1',
      '2',
    ]);
    expect(await cellsOf(rows.nth(4))).toEqual(['Counted in more than one row', '−1']);
    expect(await cellsOf(rows.nth(5))).toEqual(['Elsewhere in this branch', '+2']);
    expect(await cellsOf(rows.nth(6))).toEqual(['Total', '2', '2', '1', '1', '4', '10']);

    // The People column adds up in plain sight (section 20): 3 + 4 + 0 + 2 − 1 + 2 = 10.
    const people = await Promise.all(
      [0, 1, 2, 3].map(async (index) => Number((await cellsOf(rows.nth(index))).at(-1))),
    );
    const signed = async (index: number) =>
      Number((await cellsOf(rows.nth(index))).at(-1)!.replace('−', '-'));
    const total = Number((await cellsOf(rows.nth(6))).at(-1));
    expect(
      people.reduce((sum, count) => sum + count, 0) + (await signed(4)) + (await signed(5)),
    ).toBe(total);

    // Section 13: no proportion, no rank.
    await expect(table).not.toContainText('%');
    await expect(table.getByRole('columnheader', { name: /^(#|No\.?|Rank)$/ })).toHaveCount(0);
  });

  test('opening a name shows that leader’s 12, and their own row carries no numbers when they lead no Cell', async ({
    page,
  }) => {
    const asked = await arrange(page);
    await page.goto('/reports/cells');

    await twelveTable(page).getByRole('link', { name: TWELVE.consuelo.full_name }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]leader=${TWELVE.consuelo.id}`));
    await expect(page).toHaveURL(/[?&]month=2026-06-01/);
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
      `/reports/cells?month=2026-06-01&leader=${TWELVE.lourdes.id}`,
    );
    const own = rows.nth(1);
    await expect(own.getByRole('cell').first()).toHaveText(
      'Consuelo Bautista · no Cell of their own',
    );
    await expect(own).not.toContainText(/\d/);
    // Neither conditional line: nobody is in two rows, and nobody is elsewhere.
    await expect(
      twelveTable(page).getByText('Counted in more than one row', { exact: true }),
    ).toHaveCount(0);
    await expect(twelveTable(page).getByText('Elsewhere in this branch')).toHaveCount(0);
    expect(await cellsOf(rows.nth(2))).toEqual(['Total', '1', '1', '0', '1', '1', '4']);

    await expect(page.getByLabel('Figures for')).toHaveValue(TWELVE.consuelo.id);
  });

  test('a name opens the same period it was read in', async ({ page }) => {
    await arrange(page);
    await page.goto('/reports/cells?period=week&start=2026-06-08');

    await expect(
      twelveTable(page).getByRole('link', { name: TWELVE.efren.full_name }),
    ).toHaveAttribute(
      'href',
      `/reports/cells?period=week&start=2026-06-08&leader=${TWELVE.efren.id}`,
    );
  });

  for (const [cells, label] of [
    [1, 'You · your own Cell group'],
    [0, 'You · no Cell of your own'],
  ] as const) {
    test(`labels an own row of ${cells} Cells “${label}”`, async ({ page }) => {
      await arrange(page, { ownCells: cells });
      await page.goto('/reports/cells');

      const own = twelveTable(page).locator('tbody tr').nth(3);
      await expect(own.getByRole('cell').first()).toHaveText(label);
      if (cells === 0) {
        await expect(own).not.toContainText(/\d/);
      }
    });
  }

  test('a whole-church reader’s rows are the two pastors, each with their Network, and no own row', async ({
    page,
  }) => {
    const asked = await arrange(page);
    await mockWholeChurchReader(page);
    await page.goto('/reports/cells');

    await expectAsked(asked, { scope: 'WHOLE_CHURCH', leader_id: null });
    const rows = twelveTable(page).locator('tbody tr');
    await expect(rows).toHaveCount(4);
    // Each row is that pastor's 12, so it names the pastor with the Network beside (decision
    // 0294); nothing on the table is titled or headed by Network.
    await expect(page.getByRole('heading', { name: /^The whole church · / })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^The Networks · / })).toHaveCount(0);
    await expect(twelveTable(page).getByRole('columnheader').first()).toHaveText('Leader');
    await expect(
      rows.nth(0).getByRole('link', { name: "Bonifacio Esguerra · Men's", exact: true }),
    ).toHaveAttribute('href', new RegExp(`[?&]leader=${TWELVE.bonifacio.id}`));
    await expect(
      rows.nth(1).getByRole('link', { name: "Aurora Dizon · Women's", exact: true }),
    ).toHaveAttribute('href', new RegExp(`[?&]leader=${TWELVE.aurora.id}`));
    await expect(twelveTable(page).getByText("Men's Network")).toHaveCount(0);
    // With no own row there is no branch to be elsewhere in: the line says "In no row".
    expect(await cellsOf(rows.nth(2))).toEqual(['In no row', '+1']);
    expect(await cellsOf(rows.nth(3))).toEqual(['Total', '5', '3', '1', '1', '7', '17']);
    await expect(twelveTable(page).getByText('Elsewhere in this branch')).toHaveCount(0);
    await expect(twelveTable(page).getByText(/^You · /)).toHaveCount(0);
  });
});

test.describe('Figures for', () => {
  test('offers everyone the reader oversees, then their direct 12 by name, and nothing else', async ({
    page,
  }) => {
    await arrange(page);
    await page.goto('/reports/cells');

    const select = page.getByLabel('Figures for');
    await expect(select.locator('optgroup')).toHaveAttribute('label', 'Your direct 12');
    await expect(select.locator('option')).toHaveText([
      'Everyone you oversee',
      'Teresita Alcantara',
      'Consuelo Bautista',
      'Efren Dimaculangan',
    ]);

    await select.selectOption({ label: 'Teresita Alcantara' });
    await expect(page).toHaveURL(new RegExp(`[?&]leader=${TWELVE.teresita.id}`));
    await select.selectOption('');
    await expect(page).not.toHaveURL(/leader=/);
  });

  test('offers a whole-church reader everyone in scope and the two pastors by name', async ({
    page,
  }) => {
    await arrange(page);
    await mockWholeChurchReader(page);
    await page.goto('/reports/cells');

    const select = page.getByLabel('Figures for');
    await expect(select.locator('optgroup')).toHaveAttribute('label', 'The pastors’ 12');
    // Cell Groups has no Network figure of its own, so no Network option (unlike DCC).
    await expect(select.locator('option')).toHaveText([
      'Everyone in your scope',
      'Bonifacio Esguerra',
      'Aurora Dizon',
    ]);
    await select.selectOption({ label: 'Aurora Dizon' });
    await expect(page).toHaveURL(new RegExp(`[?&]leader=${TWELVE.aurora.id}`));
  });
});

test.describe('the coverage line', () => {
  for (const each of PERIODS) {
    test(`${each.button}: one line, linking to Filed reports on Monthly alone`, async ({
      page,
    }) => {
      await arrange(page);
      await page.goto(`/reports/cells?${each.address}`);

      // Year 2026 is due through the end of June, the current month; the week, the month and
      // Q2 all end by then, so they say nothing more.
      const due = each.kind === 'YEAR' ? ', due through 30 June' : '';
      await expect(page.locator('main p').filter({ hasText: /meetings recorded/ })).toHaveText(
        `6 of 8 meetings recorded ${each.what}${due}${each.kind === 'MONTH' ? ' · see Filed reports' : ''}`,
      );
      if (each.kind === 'MONTH') {
        await expect(page.getByRole('link', { name: 'see Filed reports' })).toHaveAttribute(
          'href',
          '/reports/filed?month=2026-06-01',
        );
      } else {
        await expect(page.getByRole('link', { name: 'see Filed reports' })).toHaveCount(0);
      }
    });
  }

  test('a past month links to that month, and a closed year says nothing about due', async ({
    page,
  }) => {
    await arrange(page);

    await page.goto('/reports/cells?month=2026-05-01');
    await expect(page.getByRole('link', { name: 'see Filed reports' })).toHaveAttribute(
      'href',
      '/reports/filed?month=2026-05-01',
    );

    await page.goto('/reports/cells?period=year&start=2025-01-01');
    await expect(page.locator('main p').filter({ hasText: /meetings recorded/ })).toHaveText(
      '6 of 8 meetings recorded in the year',
    );
  });
});

test.describe('the sentence under My 12', () => {
  test('names the period, its Sunday or last day, and says so far while it is open', async ({
    page,
  }) => {
    await arrange(page);
    const sentence = page.locator('main p').filter({ hasText: /^Different people who came/ });

    await page.goto('/reports/cells?period=week');
    await expect(sentence).toHaveText(
      'Different people who came to a Cell in the week, once each, at the stage they had reached by its Sunday, or so far while it is open. Open a name to see their 12.',
    );

    // A closed quarter: its last day, and nothing about so far.
    await page.goto('/reports/cells?period=quarter&start=2026-01-01');
    await expect(sentence).toHaveText(
      'Different people who came to a Cell in the quarter, once each, at the stage they had reached by its last day. Open a name to see their 12.',
    );
  });

  test('the heading line and How these are counted describe My 12', async ({ page }) => {
    await arrange(page);
    await page.goto('/reports/cells');

    await expect(
      page.getByText('Who came to a Cell, and where they are in their journey.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'How these are counted' }).click();
    const dialog = page.getByRole('dialog', { name: 'How these are counted' });
    await expect(dialog.getByText('My 12', { exact: true })).toBeVisible();
    await expect(
      dialog.getByText(/\(for a whole-church reader, the two pastors at the root of each Network\)/),
    ).toBeVisible();
    await expect(dialog.getByText('People who attended', { exact: true })).toHaveCount(0);
  });
});

test.describe('Back to your report', () => {
  test('keeps the period the leader was opened in', async ({ page }) => {
    await arrange(page);
    await page.goto(`/reports/cells?period=week&start=2026-06-08&leader=${TWELVE.consuelo.id}`);

    await expect(page.getByRole('link', { name: 'Back to your report' })).toHaveAttribute(
      'href',
      '/reports/cells?period=week&start=2026-06-08',
    );
  });
});

test.describe('a guard month the server disagrees with', () => {
  /** 23:59 on Tuesday 30 June 2026 in Manila, a minute before the month turns. */
  const LAST_MINUTE = new Date('2026-06-30T15:59:00Z');

  test('is asked again, once, with the month the refusal names', async ({ page }) => {
    await page.clock.setFixedTime(LAST_MINUTE);
    await mockSignedIn(page);
    // The database has already reached July, so the week of 29 June is read as of July.
    const asked = await mockCellTwelve(page, { today: '2026-07-01', expectPeriod: '2026-07-01' });
    await page.goto('/reports/cells?period=week');

    await expect(page.getByRole('heading', { name: /^My 12 · / })).toBeVisible();
    await expect(periodLabel(page, '29 Jun – 5 Jul 2026')).toBeVisible();
    await expect(page.getByText(/read as of/)).toHaveCount(0);
    const mine = asked.filter((query) => query.get('leader_id') === READER);
    // The screen may ask its own query and the reader's; each is refused once and retried once.
    expect(new Set(mine.map((query) => query.get('period')))).toEqual(
      new Set(['2026-06-01', '2026-07-01']),
    );
    expect(mine.filter((query) => query.get('period') === '2026-06-01').length).toBe(
      mine.filter((query) => query.get('period') === '2026-07-01').length,
    );
  });

  test('is not retried when the refusal names no month, and the failure is shown', async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    const asked: string[] = [];
    await page.route('**/api/v1/reports/cells/twelve*', (route) => {
      asked.push(new URL(route.request().url()).searchParams.get('period') ?? '');
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'A week starts on a Monday.',
            details: { field: 'start', value: '2026-06-16' },
          },
        }),
      });
    });
    await page.goto('/reports/cells?period=week');

    await expect(page.getByText(/A week starts on a Monday/).first()).toBeVisible();
    await expect(twelveTable(page)).toHaveCount(0);
    // Nothing asked again with another month.
    expect(new Set(asked)).toEqual(new Set(['2026-06-01']));
  });
});

test.describe('Year', () => {
  test('keeps its month-by-month table beneath My 12, and no other period shows one', async ({
    page,
  }) => {
    await arrange(page);
    await page.goto('/reports/cells?period=year');

    const months = page.getByRole('heading', { name: 'Month by month, January to June 2026' });
    await expect(months).toBeVisible();
    const twelve = page.getByRole('heading', { name: /^My 12 · / });
    const [top, bottom] = await Promise.all([twelve.boundingBox(), months.boundingBox()]);
    expect(top!.y).toBeLessThan(bottom!.y);

    for (const each of PERIODS.filter((period) => period.kind !== 'YEAR')) {
      await page.goto(`/reports/cells?${each.address}`);
      await expect(page.getByRole('heading', { name: /^My 12 · / })).toBeVisible();
      await expect(page.getByRole('heading', { name: /^Month by month/ })).toHaveCount(0);
    }
  });
});

test.describe('what decision 0293 took off this page', () => {
  test('no Month/Year radio, no Cell choices, no stages frame and no figure cards', async ({
    page,
  }) => {
    await arrange(page);
    await page.goto('/reports/cells');
    await expect(page.getByRole('heading', { name: /^My 12 · / })).toBeVisible();

    await expect(page.getByRole('radiogroup', { name: 'Report period' })).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Where people are in their journey', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recording coverage' })).toHaveCount(0);
    // Visible text only: the closed How these are counted dialog is in the page and still
    // carries the old terms.
    await expect(page.getByText('People who attended').filter({ visible: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'How often people came' })).toHaveCount(0);
    await expect(page.getByLabel('Figures for').locator('option')).toHaveCount(4);
  });
});

test.describe('at a phone, a tablet and a desktop', () => {
  for (const width of [375, 768, 1280]) {
    test(`at ${width}px no period scrolls sideways, and every control is a full target`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      await arrange(page);

      for (const each of PERIODS) {
        await page.goto(`/reports/cells?${each.address}`);
        await expect(page.getByRole('heading', { name: /^My 12 · / })).toBeVisible();
        await expect(page.locator('main').getByText('Loading…')).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth, `${each.button} scrolls sideways at ${width}px`).toBeLessThanOrEqual(
          clientWidth,
        );

        const controls = [
          ...(await periodGroup(page).getByRole('button').all()),
          page.getByRole('button', { name: 'The period before' }),
          page.getByRole('button', { name: 'The period after' }),
          page.getByLabel('Figures for'),
        ];
        for (const control of controls) {
          const box = await control.boundingBox();
          expect(
            box!.height,
            `${await control.textContent()} at ${width}px`,
          ).toBeGreaterThanOrEqual(44);
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.x + box!.width, 'a control runs off the screen').toBeLessThanOrEqual(
            clientWidth,
          );
        }
      }
    });
  }
});
