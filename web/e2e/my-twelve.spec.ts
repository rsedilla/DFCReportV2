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
 * first-name order as the API sends it, no row numbers, each name opening that leader's 12, and
 * the total adding up in plain sight. A Full view leader -- the shared account, which reads
 * reports over one Network -- reads their branch's cards and their 12 with Total second
 * (decision 0340); a whole-church reader keeps the table decision 0293 gave them.
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

/**
 * `church` reads as a whole-church reader, who keeps the running quarter and year; a leader
 * is offered finished ones only (decision 0310, pinned in `finished-periods.spec.ts`).
 */
async function arrange(page: Page, options: { ownCells?: number; church?: boolean } = {}) {
  await page.clock.setFixedTime(NOW);
  await mockSignedIn(page);
  if (options.church) {
    await mockWholeChurchReader(page);
  }
  // Year's month-by-month table reads the monthly report once per month begun.
  await mockCellReport(page);
  return mockCellTwelve(page, { today: TODAY, ownCells: options.ownCells });
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
    const asked = await arrange(page, { church: true });
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
      scope: 'WHOLE_CHURCH',
      leader_id: null,
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
    const asked = await arrange(page, { church: true });

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

  // A whole-church reader's, the one with Figures for (decision 0380).
  test('Back steps back through the period, the length and the leader', async ({ page }) => {
    await arrange(page, { church: true });
    await page.goto('/reports/cells');
    await expect(periodLabel(page, 'June 2026')).toBeVisible();

    await periodGroup(page).getByRole('button', { name: 'Weekly' }).click();
    await expect(periodLabel(page, '15 Jun – 21 Jun 2026')).toBeVisible();
    await page.getByRole('button', { name: 'The period before' }).click();
    await expect(page).toHaveURL(/[?&]start=2026-06-08/);
    await page.getByLabel('Figures for').selectOption(TWELVE.aurora.id);
    await expect(page).toHaveURL(new RegExp(`leader=${TWELVE.aurora.id}`));

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
      const asked = await arrange(page, { church: each.kind === 'QUARTER' || each.kind === 'YEAR' });
      await page.goto(`/reports/cells?${each.address}`);

      const before = page.getByRole('button', { name: 'The period before' });
      const after = page.getByRole('button', { name: 'The period after' });
      await expect(periodLabel(page, each.label)).toBeVisible();
      await expect(after).toBeDisabled();
      await expect(before).toBeEnabled();
      // A Full view leader reads it in the note under the controls (decision 0363).
      await expect(page.getByText(/(Open until|Still open, until) (7 [A-Z][a-z]+|Mon \d+ [A-Z][a-z]{2}, (12NN|12 noon))\.?$/).first()).toBeVisible();

      await before.click();
      const previous = BEFORE[each.kind];
      await expect(periodLabel(page, previous.label)).toBeVisible();
      await expectAsked(asked, { kind: each.kind, start: previous.start, period: previous.period });
      await expect(after).toBeEnabled();
      await expect(
        page
          .getByText(previous.open ? /(Open until|Still open, until) 7 [A-Z][a-z]+\.?$/ : /^Closed\.?$/)
          .first(),
      ).toBeVisible();

      await after.click();
      await expect(periodLabel(page, each.label)).toBeVisible();
      await expect(after).toBeDisabled();
    });
  }
});

test.describe('My 12', () => {
  test('a Full view leader reads their branch: the cards, then their 12 with Total second, You, the two lines and the Total (decision 0340)', async ({
    page,
  }) => {
    await arrange(page);
    await page.goto('/reports/cells');

    await expect(page.getByRole('region', { name: 'Your Disciples' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Your 12' })).toBeVisible();
    // Not the whole-church reader's table (decision 0293), which carries this heading.
    await expect(page.getByRole('heading', { name: / · their journey$/ })).toHaveCount(0);

    // No cards and no heading above the table (decision 0365): its Total row carries them.
    await expect(page.getByRole('heading', { name: 'Your Disciples' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Your Disciples' }).locator('dl')).toHaveCount(0);

    const table = twelveTable(page);
    await expect(table.getByRole('columnheader')).toHaveText([
      'Leader',
      'Total',
      'VIP',
      '2nd Timer',
      '3rd Timer',
      '4th Timer',
      'Regular',
    ]);
    await expect(table.getByRole('columnheader', { name: 'People' })).toHaveCount(0);

    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(7);

    // First-name order as sent (decision 0359), which is 4, 0, 3 by Total: neither ascending
    // nor descending.
    const names = [TWELVE.consuelo, TWELVE.efren, TWELVE.teresita];
    for (const [index, leader] of names.entries()) {
      const row = rows.nth(index);
      // No row number: the first cell is the name and nothing else, and it opens nothing
      // (decision 0380).
      await expect(row.getByRole('cell').first()).toHaveText(leader.full_name);
    }
    await expect(table.getByRole('link')).toHaveCount(0);
    expect(await cellsOf(rows.nth(0))).toEqual(['Consuelo Bautista', '4', '1', '1', '0', '1', '1']);
    expect(await cellsOf(rows.nth(1))).toEqual(['Efren Dimaculangan', '0', '0', '0', '0', '0', '0']);
    expect(await cellsOf(rows.nth(2))).toEqual(['Teresita Alcantara', '3', '1', '0', '1', '0', '1']);
    expect(await cellsOf(rows.nth(3))).toEqual([
      'You · your own Cell Groups (2)',
      '2',
      '0',
      '1',
      '0',
      '0',
      '1',
    ]);
    expect((await cellsOf(rows.nth(4))).slice(0, 2)).toEqual([
      'Counted under more than one leader',
      '−1',
    ]);
    expect((await cellsOf(rows.nth(5))).slice(0, 2)).toEqual(['Elsewhere in this branch', '+2']);
    const totalRow = await cellsOf(rows.nth(6));
    expect(totalRow).toEqual(['Total', '10', '2', '2', '1', '1', '4']);

    // The Total column adds up in plain sight (section 20): 4 + 0 + 3 + 2 − 1 + 2 = 10.
    const signed = async (index: number) =>
      Number((await cellsOf(rows.nth(index)))[1].replace('−', '-'));
    let sum = 0;
    for (const index of [0, 1, 2, 3, 4, 5]) {
      sum += await signed(index);
    }
    expect(sum).toBe(Number(totalRow[1]));

    // Section 13: no proportion, no rank.
    await expect(table).not.toContainText('%');
    await expect(table.getByRole('columnheader', { name: /^(#|No\.?|Rank)$/ })).toHaveCount(0);
  });

  test('a leader in the address shows that leader’s branch and 12, and their own row carries no numbers when they lead no Cell', async ({
    page,
  }) => {
    const asked = await arrange(page);
    await page.goto(`/reports/cells?month=2026-06-01&leader=${TWELVE.consuelo.id}`);
    await expectAsked(asked, { scope: 'LEADER', leader_id: TWELVE.consuelo.id });

    await expect(page.getByRole('region', { name: 'Consuelo Bautista’s Disciples' })).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Consuelo Bautista’s 12' }),
    ).toBeVisible();
    const rows = twelveTable(page).locator('tbody tr');
    await expect(rows).toHaveCount(3);
    // Her branch's figures are the Total row, there being no cards above (decision 0365).
    expect(await cellsOf(rows.nth(2))).toEqual(['Total', '4', '1', '1', '0', '1', '1']);
    await expect(rows.nth(0).getByRole('cell').first()).toHaveText(TWELVE.lourdes.full_name);
    await expect(twelveTable(page).getByRole('link')).toHaveCount(0);
    const own = rows.nth(1);
    await expect(own.getByRole('cell').first()).toHaveText(
      'Consuelo Bautista · no Cell of their own',
    );
    await expect(own).not.toContainText(/\d/);
    // Neither conditional line: nobody is in two rows, and nobody is elsewhere.
    await expect(
      twelveTable(page).getByText('Counted under more than one leader', { exact: true }),
    ).toHaveCount(0);
    await expect(twelveTable(page).getByText('Elsewhere in this branch')).toHaveCount(0);
    expect(await cellsOf(rows.nth(2))).toEqual(['Total', '4', '1', '1', '0', '1', '1']);

    // A Full view leader has no Figures for (decision 0380).
    await expect(page.getByLabel('Figures for')).toHaveCount(0);
  });

  test('says on every period but Monthly that periods are never added together', async ({
    page,
  }) => {
    await arrange(page);
    const note = page.getByText(/^Periods are never added together/);

    await page.goto('/reports/cells');
    await expect(page.getByRole('table', { name: 'Your 12' })).toBeVisible();
    await expect(note).toHaveCount(0);

    await page.goto('/reports/cells?period=week');
    await expect(page.getByRole('table', { name: 'Your 12' })).toBeVisible();
    await expect(note).toHaveText(
      'Periods are never added together: somebody who came in three weeks counts once in the month.',
    );
  });

  test('a name opens nothing on Weekly either (decision 0380)', async ({ page }) => {
    await arrange(page);
    await page.goto('/reports/cells?period=week&start=2026-06-08');

    await expect(twelveTable(page).getByText(TWELVE.efren.full_name)).toBeVisible();
    await expect(twelveTable(page).getByRole('link')).toHaveCount(0);
  });

  for (const [cells, label] of [
    [1, 'You · your own Cell Group'],
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
    await expect(page.getByRole('heading', { name: /^Whole Church · / })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^The Networks · / })).toHaveCount(0);
    await expect(twelveTable(page).getByRole('columnheader').first()).toHaveText('Leader');
    await expect(
      rows.nth(0).getByRole('link', { name: "Bonifacio Esguerra · Men's", exact: true }),
    ).toHaveAttribute('href', new RegExp(`[?&]leader=${TWELVE.bonifacio.id}`));
    await expect(
      rows.nth(1).getByRole('link', { name: "Aurora Dizon · Women's", exact: true }),
    ).toHaveAttribute('href', new RegExp(`[?&]leader=${TWELVE.aurora.id}`));
    await expect(twelveTable(page).getByText("Men's Network")).toHaveCount(0);
    // With no own row there is no branch to be elsewhere in: the line says "Under none of these leaders".
    expect(await cellsOf(rows.nth(2))).toEqual(['Under none of these leaders', '+1']);
    expect(await cellsOf(rows.nth(3))).toEqual(['Total', '5', '3', '1', '1', '7', '17']);
    await expect(twelveTable(page).getByText('Elsewhere in this branch')).toHaveCount(0);
    await expect(twelveTable(page).getByText(/^You · /)).toHaveCount(0);
  });
});

test.describe('Figures for', () => {
  test('a Full view leader has none: they read their own branch (decision 0380)', async ({
    page,
  }) => {
    await arrange(page);
    await page.goto('/reports/cells');

    await expect(page.getByRole('table', { name: 'Your 12' })).toBeVisible();
    await expect(page.getByLabel('Figures for')).toHaveCount(0);
    await expect(periodGroup(page).getByRole('button')).toHaveText(['Weekly', 'Monthly']);
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
      'Whole Church',
      'Bonifacio Esguerra',
      'Aurora Dizon',
    ]);
    await select.selectOption({ label: 'Aurora Dizon' });
    await expect(page).toHaveURL(new RegExp(`[?&]leader=${TWELVE.aurora.id}`));
  });
});

test.describe('the coverage line', () => {
  // A whole-church reader's: a Full view leader's tab carries none (decision 0363), below.
  for (const each of PERIODS) {
    test(`${each.button}: one line, linking nowhere (decision 0340)`, async ({ page }) => {
      await arrange(page, { church: true });
      await page.goto(`/reports/cells?${each.address}`);

      // Year 2026 is due through the end of June, the current month; the week, the month and
      // Q2 all end by then, so they say nothing more.
      const due = each.kind === 'YEAR' ? ', due through 30 June' : '';
      const line = page.locator('main p').filter({ hasText: /meetings recorded/ });
      await expect(line).toHaveText(`6 of 8 meetings recorded ${each.what}${due}`);
      // Filed Reports is withdrawn, and the line's link with it.
      await expect(line.getByRole('link')).toHaveCount(0);
      await expect(page.locator('a[href^="/reports/filed"]')).toHaveCount(0);
    });
  }

  test('a Full view leader has none, and the note under the controls says whether it is open (decision 0363)', async ({
    page,
  }) => {
    await arrange(page);
    const note = page.locator('main p').filter({ hasText: /^(Still open, until .+|Closed)\.$/ });

    await page.goto('/reports/cells');
    await expect(page.locator('main p').filter({ hasText: /meetings recorded/ })).toHaveCount(0);
    await expect(note).toHaveText('Still open, until 7 July.');

    await page.goto('/reports/cells?month=2026-05-01');
    await expect(note).toHaveText('Closed.');
  });

  test('a past month reads that month, and a closed year says nothing about due', async ({
    page,
  }) => {
    await arrange(page, { church: true });

    await page.goto('/reports/cells?month=2026-05-01');
    await expect(page.locator('main p').filter({ hasText: /meetings recorded/ })).toHaveText(
      '6 of 8 meetings recorded in the month',
    );

    await page.goto('/reports/cells?period=year&start=2025-01-01');
    await expect(page.locator('main p').filter({ hasText: /meetings recorded/ })).toHaveText(
      '6 of 8 meetings recorded in the year',
    );
  });
});

test.describe('the sentence under My 12', () => {
  test('names the period, and says so far while it is open and by its end once closed', async ({
    page,
  }) => {
    // The sentence belongs to the whole-church reader's table (decision 0293).
    await arrange(page, { church: true });
    const sentence = page.locator('main p').filter({ hasText: /^Everyone who came/ });

    await page.goto('/reports/cells?period=week');
    await expect(sentence).toHaveText(
      'Everyone who came to a Cell in the week, counted once, at their stage so far. Open a name to see their 12.',
    );

    // A closed quarter: by its end, and nothing about so far.
    await page.goto('/reports/cells?period=quarter&start=2026-01-01');
    await expect(sentence).toHaveText(
      'Everyone who came to a Cell in the quarter, counted once, at their stage by its end. Open a name to see their 12.',
    );
  });

  test('the heading line describes the report', async ({ page }) => {
    await arrange(page);
    await page.goto('/reports/cells');

    await expect(
      page.getByText('Who came to a Cell, and where they are in their journey.'),
    ).toBeVisible();
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

    await expect(page.getByRole('region', { name: 'Your Disciples' })).toBeVisible();
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
    await arrange(page, { church: true });
    await page.goto('/reports/cells?period=year');

    const months = page.getByRole('heading', { name: 'Month by month, January to June 2026' });
    await expect(months).toBeVisible();
    // A whole-church reader's table is headed by the church rather than "My 12".
    const twelve = page.getByRole('heading', { name: / · their journey$/ });
    const [top, bottom] = await Promise.all([twelve.boundingBox(), months.boundingBox()]);
    expect(top!.y).toBeLessThan(bottom!.y);

    for (const each of PERIODS.filter((period) => period.kind !== 'YEAR')) {
      await page.goto(`/reports/cells?${each.address}`);
      await expect(page.getByRole('heading', { name: / · their journey$/ })).toBeVisible();
      await expect(page.getByRole('heading', { name: /^Month by month/ })).toHaveCount(0);
    }
  });
});

test.describe('what decision 0293 took off this page', () => {
  test('no Month/Year radio, no Cell choices and no stages frame', async ({ page }) => {
    await arrange(page);
    await page.goto('/reports/cells');
    await expect(page.getByRole('region', { name: 'Your Disciples' })).toBeVisible();

    await expect(page.getByRole('radiogroup', { name: 'Report period' })).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Where people are in their journey', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recording coverage' })).toHaveCount(0);
    await expect(page.getByText('People who attended')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'How often people came' })).toHaveCount(0);
    await expect(page.getByLabel('Figures for')).toHaveCount(0);
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

      // A Full view leader's two lengths (decision 0380).
      for (const each of PERIODS.filter((period) => period.kind === 'WEEK' || period.kind === 'MONTH')) {
        await page.goto(`/reports/cells?${each.address}`);
        await expect(page.getByRole('region', { name: 'Your Disciples' })).toBeVisible();
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
