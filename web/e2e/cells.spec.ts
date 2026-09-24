import { expect, test, type Page } from '@playwright/test';

import {
  CREATED_CELL,
  PERSON_IN_SCOPE,
  mockCellApprover,
  mockCellCreated,
  mockMembershipAdd,
  mockPeople,
  mockPeopleWithoutACell,
  mockSignedIn,
} from './mock-api';
import {
  CELL_WITH_MEETINGS,
  CELL_WITH_NO_SCHEDULE,
  closedAsked,
  mockCellMeetings,
  mockCellMembers,
  mockCellMembersEmpty,
  mockClosedCellMeetings,
  mockCells,
  mockCellsWithClosed,
} from './mock-attendance';

/**
 * What the Cells screens let a leader do, as opposed to what they look like (UI-5).
 *
 * `accessibility.spec.ts` scans these states for conformance, and cannot tell whether a
 * day that has not come reads as awaited, what a schedule change sends, or whether a
 * placed person leaves the list. These cases pin that behaviour.
 */

const MEETINGS = `/cells/${CELL_WITH_MEETINGS.id}/meetings`;
const MEMBERS = `/cells/${CELL_WITH_MEETINGS.id}/members`;

test.describe('the Cells list', () => {
  test('is a table on a laptop and cards on a phone, with a way to people without a Cell', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/cells');

    const table = page.getByRole('table', { name: 'Cells in your scope' });
    await expect(table.getByRole('columnheader')).toHaveText([
      'Cell',
      'Leader',
      'Members',
      'Meets',
      'Recorded',
    ]);
    // The Cell is named rather than coded, with its identifier beneath (decision 0261).
    await expect(table.getByRole('link', { name: 'Couple · Wed' })).toBeVisible();
    await expect(table.getByRole('row', { name: /Couple · Wed/ })).toContainText('4');
    // A link styled as a button in the header (decision 0289), and still a link.
    await expect(page.getByRole('link', { name: 'People without a Cell' })).toHaveAttribute(
      'href',
      '/cells/people-without-a-cell',
    );
    await expect(page.getByText('Your Cells, and this month’s meetings recorded.')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(table).toBeHidden();
    await expect(page.getByRole('heading', { name: 'CELL-000011' })).toBeVisible();
    // A phone card carries the member count the table does (walkthrough, 2026-09-21).
    const card = page.getByRole('listitem').filter({ hasText: 'CELL-000011' });
    await expect(card).toContainText(/Members\s*4/);
  });
});

/**
 * The Cells index as the totals see it: every page of a count read (`limit=200`) is
 * answered separately from the list's own ten-a-page read, so a count that stops after
 * its first page reads short. The scope count spans two pages of 2 and 3; the Cells the
 * reader leads are one page of 1. Every request is kept, so a case can say what was asked.
 */
async function mockCellTotals(page: Page): Promise<URL[]> {
  const asked: URL[] = [];
  const cell = (n: number) => ({
    ...CELL_WITH_MEETINGS,
    id: `3f1b7c6e-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`,
    cell_id: `CELL-0003${String(n).padStart(2, '0')}`,
  });
  const body = (data: unknown[], next_cursor: string | null) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ reporting_month: '2026-06-01', open: true, data, next_cursor }),
  });

  await page.route('**/api/v1/cells?*', (route) => {
    const url = new URL(route.request().url());
    asked.push(url);
    const mine = url.searchParams.get('led_by') === 'me';

    if (closedAsked(url.toString())) {
      return route.fulfill(body([], null));
    }
    if (url.searchParams.get('limit') === '200') {
      if (mine) {
        return route.fulfill(body([cell(1)], null));
      }
      return url.searchParams.get('cursor') === 'second-page'
        ? route.fulfill(body([cell(3), cell(4), cell(5)], null))
        : route.fulfill(body([cell(1), cell(2)], 'second-page'));
    }
    return route.fulfill(
      body(mine ? [CELL_WITH_MEETINGS] : [CELL_WITH_MEETINGS, CELL_WITH_NO_SCHEDULE], null),
    );
  });

  return asked;
}

/** The list's own reads, as opposed to the totals' (which ask for 200 a page). */
function listReads(asked: URL[]): URL[] {
  return asked.filter((url) => url.searchParams.get('limit') !== '200');
}

test.describe('the Cells totals (decision 0289)', () => {
  // 10:00 on 24 June in Manila, so the current month is June 2026 and May is one back.
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-06-24T02:00:00Z'));
  });

  const lead = (page: Page) => page.getByRole('button', { name: /^Cells you lead/ });
  const scope = (page: Page) => page.getByRole('button', { name: /^Cells in your scope/ });

  test('shows both totals, each counted and dated as of today', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellTotals(page);
    await page.goto('/cells');

    await expect(lead(page)).toContainText(/Cells you lead\s*1\s*Your own Cells · as of today/);
    await expect(scope(page)).toContainText(
      /Cells in your scope\s*5\s*The Cells you oversee · as of today/,
    );
  });

  test('counts every page, 200 at a time, and asks for the reader’s own by led_by=me', async ({
    page,
  }) => {
    await mockSignedIn(page);
    const asked = await mockCellTotals(page);
    await page.goto('/cells');
    // Both totals have arrived, so every page either one asked for has been asked.
    await expect(scope(page)).toContainText(/Cells in your scope\s*5\s*The/);
    await expect(lead(page)).toContainText(/Cells you lead\s*1\s*Your/);

    const counts = asked.filter((url) => url.searchParams.get('limit') === '200');
    const mine = counts.filter((url) => url.searchParams.get('led_by') === 'me');
    const scoped = counts.filter((url) => !url.searchParams.has('led_by'));

    // The current month, running Cells only: a count never asks for the closed view.
    for (const url of counts) {
      expect(url.searchParams.get('month')).toBe('2026-06-01');
      expect(url.searchParams.has('state')).toBe(false);
      expect(url.searchParams.has('q')).toBe(false);
    }
    expect(mine.length).toBeGreaterThanOrEqual(1);
    // Both pages of the scope count were asked for, the second by the first's cursor.
    expect(scoped.map((url) => url.searchParams.get('cursor'))).toEqual(
      expect.arrayContaining([null, 'second-page']),
    );
  });

  test('pressing Cells you lead shows only the reader’s own, and pressing the other clears it', async ({
    page,
  }) => {
    await mockSignedIn(page);
    const asked = await mockCellTotals(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/cells');

    // The unfiltered list of this month's running Cells is what "in your scope" counts.
    await expect(scope(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(lead(page)).toHaveAttribute('aria-pressed', 'false');

    await lead(page).click();
    await expect(page).toHaveURL(/[?&]mine=1(&|$)/);
    await expect(lead(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(scope(page)).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(() => listReads(asked).some((url) => url.searchParams.get('led_by') === 'me'))
      .toBe(true);
    const table = page.getByRole('table', { name: 'Cells in your scope' });
    await expect(table.getByRole('link', { name: 'Youth · Sat' })).toBeVisible();
    await expect(table.getByRole('link', { name: 'Couple · Wed' })).toHaveCount(0);

    await scope(page).click();
    await expect(page).not.toHaveURL(/mine=/);
    await expect(scope(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(lead(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(table.getByRole('link', { name: 'Couple · Wed' })).toBeVisible();
  });

  test('another month is not what the totals count, and pressing one returns to this month', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellTotals(page);
    await page.goto('/cells?mine=1');
    await expect(lead(page)).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Show May 2026' }).click();
    await expect(page).toHaveURL(/month=2026-05-01/);
    await expect(lead(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(scope(page)).toHaveAttribute('aria-pressed', 'false');

    await lead(page).click();
    await expect(page).not.toHaveURL(/month=/);
    await expect(page).toHaveURL(/[?&]mine=1(&|$)/);
    await expect(lead(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('the closed view is not what the totals count, and pressing one returns to running Cells', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellTotals(page);
    await page.goto('/cells');

    await page.getByRole('radio', { name: 'Closed Cells' }).check();
    await expect(page).toHaveURL(/view=CLOSED/);
    await expect(lead(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(scope(page)).toHaveAttribute('aria-pressed', 'false');

    await scope(page).click();
    await expect(page).not.toHaveURL(/view=/);
    await expect(page.getByRole('radio', { name: 'Running Cells' })).toBeChecked();
    await expect(scope(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('a search is not what the totals count, and pressing one clears it', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellTotals(page);
    await page.goto('/cells');

    await page.getByLabel('Search by Cell ID or leader').fill('youth');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=youth/);
    await expect(lead(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(scope(page)).toHaveAttribute('aria-pressed', 'false');

    await lead(page).click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.getByLabel('Search by Cell ID or leader')).toHaveValue('');
    await expect(lead(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('the header puts People without a Cell beside New Cell, over the new line', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellApprover(page);
    await mockCellTotals(page);
    await page.goto('/cells');

    const header = page.locator('main > div').first();
    await expect(header.getByRole('heading', { name: 'Cells', exact: true })).toBeVisible();
    await expect(header.getByRole('link')).toHaveText(['People without a Cell', 'New Cell']);
    await expect(header.getByRole('link', { name: 'People without a Cell' })).toHaveAttribute(
      'href',
      '/cells/people-without-a-cell',
    );
    await expect(header.getByRole('link', { name: 'New Cell' })).toHaveAttribute(
      'href',
      '/cells/new',
    );
    await expect(page.getByText('Your Cells, and this month’s meetings recorded.')).toBeVisible();
  });
});

test.describe('the browser Back button on the Cells list', () => {
  test('steps back through the search, the filter and the closed view', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellsWithClosed(page);
    await page.goto('/cells');

    await page.getByLabel('Search by Cell ID or leader').fill('youth');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=youth/);

    await page.getByRole('button', { name: 'Show only my Cells' }).click();
    await expect(page).toHaveURL(/mine=1/);

    await page.getByRole('radio', { name: 'Closed Cells' }).check();
    await expect(page).toHaveURL(/view=CLOSED/);

    // A reload keeps all three, because they are in the address rather than on the screen.
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Closed Cells' })).toBeChecked();
    await expect(page.getByLabel('Search by Cell ID or leader')).toHaveValue('youth');

    await page.goBack();
    await expect(page).not.toHaveURL(/view=CLOSED/);
    await expect(page).toHaveURL(/mine=1/);

    await page.goBack();
    await expect(page).not.toHaveURL(/mine=1/);
    await expect(page).toHaveURL(/q=youth/);

    await page.goBack();
    await expect(page).not.toHaveURL(/q=youth/);
    // The box follows the address back, rather than keeping a term nobody is searching for.
    await expect(page.getByLabel('Search by Cell ID or leader')).toHaveValue('');
  });
});

test.describe('New Cell', () => {
  test('is offered only to a Whole Church holder of cell.approve_leadership', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await page.goto('/cells');
    await expect(page.getByRole('heading', { name: 'Cells', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New Cell' })).toHaveCount(0);

    await mockCellApprover(page);
    await page.reload();
    await expect(page.getByRole('link', { name: 'New Cell' })).toHaveAttribute(
      'href',
      '/cells/new',
    );
  });

  test('sends the leader, category, day and time, then opens the new Cell’s members', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellApprover(page);
    await mockPeople(page);
    await mockCellMembersEmpty(page);
    const sent = await mockCellCreated(page);
    await page.goto('/cells/new');

    const create = page.getByRole('button', { name: 'Create Cell' });
    await expect(create).toBeDisabled();

    await page.getByLabel('Search for the leader by name').fill('Marilou');
    await page.getByRole('button', { name: 'Find' }).click();
    await page.getByRole('button', { name: 'Choose' }).first().click();
    await page.getByRole('radio', { name: 'Young Pro' }).check();
    await page.getByRole('combobox', { name: 'Meets every' }).selectOption({ label: 'Friday' });
    await page.getByLabel('At').fill('19:30');
    await create.click();

    await expect(page).toHaveURL(`/cells/${CREATED_CELL.id}/members`);
    expect(sent).toEqual([
      {
        cell_leader_id: PERSON_IN_SCOPE.id,
        category: 'YOUNG_PRO',
        day_of_week: 5,
        time_of_day: '19:30',
      },
    ]);
  });
});

test.describe('a Cell’s meetings', () => {
  test('a meeting whose day has not come reads Not yet rather than awaiting a record', async ({
    page,
  }) => {
    // 10:00 on 24 June in Manila: the 27 June meeting has no record and its day has not come.
    await page.clock.setFixedTime(new Date('2026-06-24T02:00:00Z'));
    await mockSignedIn(page);
    await mockCellMeetings(page);
    await page.goto(MEETINGS);

    const row = page.getByRole('row').filter({ hasText: 'Saturday 27 June' });
    await expect(row.getByText('Not yet')).toBeVisible();
    await expect(page.getByText('Awaiting a record').filter({ visible: true })).toHaveCount(0);
  });

  test('changes when it meets from the next month, and says so once saved', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-06-24T02:00:00Z'));
    await mockSignedIn(page);
    await mockCellMeetings(page);

    const sent: unknown[] = [];
    await page.route('**/api/v1/cells/*/schedule', (route) => {
      sent.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    await page.goto(MEETINGS);
    await page.getByRole('button', { name: 'Change when it meets' }).click();

    const dialog = page.getByRole('dialog', { name: 'Change when CELL-000007 meets' });
    await expect(dialog.getByText('Meets now on Saturday at 19:00.')).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Which day, from July 2026' })).toBeVisible();

    await dialog.getByRole('radio', { name: 'Wednesday' }).check();
    await dialog.getByLabel('What time').fill('20:00');
    await dialog.getByRole('button', { name: 'Move to Wednesday from 1 July 2026' }).click();

    await expect(dialog).toBeHidden();
    expect(sent).toEqual([{ day_of_week: 3, time_of_day: '20:00' }]);
    await expect(page.getByText('Saved. It takes effect on 1 July 2026.')).toBeVisible();
  });

  test('a closed Cell is offered no schedule change', async ({ page }) => {
    await mockSignedIn(page);
    await mockClosedCellMeetings(page);
    await page.goto(MEETINGS);

    await expect(
      page.getByText('CELL-000007 · led by Teofilo Ramos · closed on Saturday 20 June'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Members' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change when it meets' })).toHaveCount(0);
  });
});

test.describe('a Cell’s members', () => {
  test('adds a member from the dialog in one request, and names who was added', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockCellMeetings(page);
    await mockCellMembers(page);
    const sent = await mockMembershipAdd(page, 'accepted');

    await page.goto(MEMBERS);

    // The Cell is named the way every other Cells screen names it, over its identifier,
    // its leader and its size.
    await expect(
      page.getByRole('heading', { level: 1, name: 'Youth · Saturdays 7:00 pm' }),
    ).toBeVisible();
    await expect(
      page.getByText('CELL-000007 · led by Teofilo Ramos · 2 members'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Add a member' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add a member to CELL-000007' });
    await dialog.getByLabel('Search for a person by name').fill('Marilou');
    await dialog.getByRole('button', { name: 'Find' }).click();
    await dialog.getByRole('button', { name: 'Choose' }).first().click();
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(dialog).toBeHidden();
    expect(sent).toEqual([
      { path: `/api/v1/cells/${CELL_WITH_MEETINGS.id}/members`, body: { person_id: PERSON_IN_SCOPE.id } },
    ]);
    await expect(page.getByText(`Added ${PERSON_IN_SCOPE.full_name}.`)).toBeVisible();
  });

  test('dates "member since" by the Manila day, not the UTC one', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockCellMeetings(page);
    await mockCellMembers(page);

    await page.goto(MEMBERS);

    // Added at 1 am on 12 May in Manila, which is 11 May in UTC.
    await expect(page.getByText('Tuesday 12 May').first()).toBeVisible();
    await expect(page.getByText('Monday 11 May')).toHaveCount(0);
  });

  test('a closed Cell says so and is offered nothing to add', async ({ page }) => {
    await mockSignedIn(page);
    await mockClosedCellMeetings(page);
    await mockCellMembersEmpty(page);

    await page.goto(MEMBERS);

    // Section 10 ends every membership at closure, and the route refuses an addition, so
    // the screen says what happened rather than offering a control that always fails.
    await expect(
      page.getByText('CELL-000007 · led by Teofilo Ramos · closed on Saturday 20 June'),
    ).toBeVisible();
    await expect(
      page.getByText('Closing this Cell ended every membership in it.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a member' })).toBeHidden();
  });

  test('a member’s name opens their profile', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellMembers(page);
    await page.goto(MEMBERS);

    await expect(page.getByRole('link', { name: 'Rosalinda Ocampo' })).toHaveAttribute(
      'href',
      '/people/3f1b7c6e-0000-4000-8000-000000000601',
    );
  });
});

test.describe('people without a Cell', () => {
  test('places a person from the list in one request, and asks for the list again', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeopleWithoutACell(page);
    await mockCells(page);
    const sent = await mockMembershipAdd(page, 'accepted');

    let listReads = 0;
    page.on('request', (request) => {
      if (request.method() === 'GET' && request.url().includes('/cells/people-without-a-cell')) {
        listReads += 1;
      }
    });

    await page.goto('/cells/people-without-a-cell');
    await expect(page.getByRole('heading', { name: 'Bituin Carreon' })).toBeVisible();
    // **Counted from here, not from page load.** Loading the page can read the list more than
    // once, so "more than one read" held with no refresh at all, and a mutant removing the
    // refresh passed this case.
    const readsBeforeAdding = listReads;
    await page.getByRole('button', { name: 'Add to a Cell' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Add Bituin Carreon to a Cell' });
    await dialog.getByRole('combobox', { name: 'Cell' }).selectOption(CELL_WITH_NO_SCHEDULE.id);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(dialog).toBeHidden();
    expect(sent).toEqual([
      {
        path: `/api/v1/cells/${CELL_WITH_NO_SCHEDULE.id}/members`,
        body: { person_id: '3f1b7c6e-0000-4000-8000-000000000921' },
      },
    ]);
    await expect.poll(() => listReads).toBeGreaterThan(readsBeforeAdding);
  });
});

test.describe('closed Cells and their restart (decisions 0264 to 0266)', () => {
  test('lists closed Cells in their own view, and sends a restart for approval', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellsWithClosed(page);

    const sent: unknown[] = [];
    await page.route('**/api/v1/cells/leadership-requests', (route) => {
      sent.push(route.request().postDataJSON());
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'r1', state: 'PENDING' }),
      });
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/cells');
    await page.getByRole('radio', { name: 'Closed Cells' }).check();

    const table = page.getByRole('table', { name: 'Closed Cells in your scope' });
    await expect(table.getByRole('columnheader')).toHaveText([
      'Cell',
      'Last leader',
      'Closed',
      'Why',
      'Restart',
    ]);
    const row = table.getByRole('row', { name: /CELL-000014/ });
    await expect(row).toContainText('Paolo Reyes');
    await expect(row).toContainText('12 Jun 2026');
    await expect(row).toContainText('Members dispersed');

    await row.getByRole('button', { name: 'Restart CELL-000014' }).click();

    const dialog = page.getByRole('dialog', { name: 'Restart CELL-000014' });
    // Filled in from how it met before, and the leader is a sentence, not a field.
    await expect(dialog.getByText('Paolo Reyes', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Young Pro' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Friday' })).toBeChecked();
    await expect(dialog.getByLabel('What time')).toHaveValue('19:30');

    await dialog.getByRole('radio', { name: 'Saturday' }).check();
    await dialog.getByRole('button', { name: 'Send for approval' }).click();

    await expect(dialog).toBeHidden();
    expect(sent).toEqual([
      {
        kind: 'NEW_CELL',
        restart_of_cell_id: '4a2c8d90-0000-4000-8000-000000000601',
        prospective_leader_id: '4a2c8d90-0000-4000-8000-000000000701',
        category: 'YOUNG_PRO',
        day_of_week: 6,
        time_of_day: '19:30',
      },
    ]);
    await expect(row).toContainText('Sent for approval');
  });

  test('offers no restart where the server says none may be asked for', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellsWithClosed(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/cells');
    await page.getByRole('radio', { name: 'Closed Cells' }).check();

    const table = page.getByRole('table', { name: 'Closed Cells in your scope' });
    const restarted = table.getByRole('row', { name: /CELL-000009/ });
    await expect(restarted).toContainText('Restarted as CELL-000021');
    await expect(restarted.getByRole('button')).toHaveCount(0);

    const inError = table.getByRole('row', { name: /CELL-000004/ });
    await expect(inError).toContainText('Created in error');
    await expect(inError.getByRole('button')).toHaveCount(0);
  });
});

test.describe('the Cell picker (owner’s choice, 2026-09-21)', () => {
  test('lifts the person’s pastoral leader’s Cell to the top, and leaves the rest in order', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeopleWithoutACell(page);
    await mockCells(page);
    // Bituin's pastoral leader leads CELL-000011, the second Cell in the API's order.
    await page.route('**/api/v1/people/*/pastoral-path*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: '3f1b7c6e-0000-4000-8000-000000000990',
              member_id: 'M-000001',
              full_name: 'Remedios Tolentino',
              network_root: true,
            },
            {
              id: CELL_WITH_NO_SCHEDULE.leader.person_id,
              member_id: CELL_WITH_NO_SCHEDULE.leader.member_id,
              full_name: CELL_WITH_NO_SCHEDULE.leader.full_name,
              network_root: false,
            },
            {
              id: '3f1b7c6e-0000-4000-8000-000000000921',
              member_id: 'M-000921',
              full_name: 'Bituin Carreon',
              network_root: false,
            },
          ],
          next_cursor: null,
        }),
      }),
    );

    await page.goto('/cells/people-without-a-cell');
    await page.getByRole('button', { name: 'Add to a Cell' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Add Bituin Carreon to a Cell' });
    const groups = dialog.locator('optgroup');
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toHaveAttribute('label', 'Their pastoral leader’s Cell');
    await expect(groups.nth(0).locator('option')).toHaveText([/CELL-000011/]);
    await expect(groups.nth(1)).toHaveAttribute('label', 'Other Cells you oversee');
    await expect(groups.nth(1).locator('option')).toHaveText([/CELL-000007/]);
    // Nothing is chosen for them: the leader still picks.
    await expect(dialog.getByRole('combobox', { name: 'Cell' })).toHaveValue('');
  });
});
