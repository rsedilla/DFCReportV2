import { expect, test, type Page } from '@playwright/test';

import {
  CELL_CHOICES,
  CREATED_CELL,
  MEMBER_CHOICES,
  PERSON_IN_SCOPE,
  SIGNED_IN_PERSON_ID,
  chooseThreeMembers,
  mockCellAdministrator,
  mockCellApprover,
  mockCellChoices,
  mockCellCreated,
  mockGrants,
  mockMembershipAdd,
  mockMemberSearch,
  mockPeople,
  mockPersonCells,
  mockSignedIn,
  searchCells,
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
  test('is a table on a laptop and cards on a phone', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/cells');

    const table = page.getByRole('table', { name: 'Cells you oversee' });
    await expect(table.getByRole('columnheader')).toHaveText([
      'Cell',
      'Leader',
      'Members',
      'Meets',
      'Recorded',
    ]);
    // The Cell is named rather than coded (decisions 0261 and 0306).
    await expect(table.getByRole('link', { name: 'Couple · Wed' })).toBeVisible();
    await expect(table.getByRole('row', { name: /Couple · Wed/ })).toContainText('4');
    // Record's No CG Yet is where that list lives (decision 0343).
    await expect(page.getByRole('link', { name: 'People without a Cell' })).toHaveCount(0);
    // The heading carries no line: the headline and the month say it (decision 0402).
    await expect(page.getByText('Your Cells and this month’s meetings.')).toHaveCount(0);
    await expect(page.getByText('Your Cells, and this month’s meetings recorded.')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(table).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Couple · Wed' })).toBeVisible();
    // A phone card carries the member count the table does (walkthrough, 2026-09-21).
    const card = page.getByRole('listitem').filter({ hasText: 'Couple · Wed' });
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

  await page.route('**/api/v1/cells/counts', (route) => {
    asked.push(new URL(route.request().url()));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ in_scope: 5, led_by_me: 1 }),
    });
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

test.describe('the Cells total (decision 0400)', () => {
  // 10:00 on 24 June in Manila, so the current month is June 2026 and May is one back.
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-06-24T02:00:00Z'));
  });

  const headline = (page: Page) => page.getByRole('heading', { name: /^\d+ Cells?$/ });

  test('heads the list with one total, with how many the reader leads, as of today', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellTotals(page);
    await page.goto('/cells');

    await expect(headline(page)).toHaveText('5 Cells');
    await expect(page.getByText('1 you lead · 4 under your leaders · as of today')).toBeVisible();
    // Information only: neither of decision 0289's two cards is left, and nothing filters.
    await expect(page.getByRole('button', { name: /^Cells you (lead|oversee)/ })).toHaveCount(0);
  });

  // Decision 0309: both figures come from one counts request, and never from reading every
  // page of the list with its figures.
  test('reads the total from one counts request, and never pages the list for it', async ({
    page,
  }) => {
    await mockSignedIn(page);
    const asked = await mockCellTotals(page);
    await page.goto('/cells');
    await expect(headline(page)).toHaveText('5 Cells');

    expect(asked.filter((url) => url.pathname === '/api/v1/cells/counts')).toHaveLength(1);
    expect(asked.filter((url) => url.searchParams.get('limit') === '200')).toHaveLength(0);
    // The list is never narrowed to the reader's own: they come first instead.
    expect(listReads(asked).some((url) => url.searchParams.has('led_by'))).toBe(false);
  });

  test('marks the reader’s own Cell You lead, in the table and on a phone', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellTotals(page);
    // Registered last, so it answers the list: the server puts the reader's own first.
    await page.route('**/api/v1/cells?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reporting_month: '2026-06-01',
          open: true,
          data: [
            {
              ...CELL_WITH_MEETINGS,
              leader: { ...CELL_WITH_MEETINGS.leader, person_id: SIGNED_IN_PERSON_ID },
            },
            CELL_WITH_NO_SCHEDULE,
          ],
          next_cursor: null,
        }),
      }),
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/cells');

    const table = page.getByRole('table', { name: 'Cells you oversee' });
    const rows = table.locator('tbody tr');
    await expect(rows.nth(0)).toContainText('Youth · SatYou lead');
    await expect(rows.nth(1)).not.toContainText('You lead');

    await page.setViewportSize({ width: 390, height: 844 });
    const own = page.getByRole('listitem').filter({ hasText: 'Youth · Sat' });
    await expect(own).toContainText('You lead');
    await expect(page.getByRole('listitem').filter({ hasText: 'Couple · Wed' })).not.toContainText(
      'You lead',
    );
  });

  test('lines the two counts up on the right of their columns', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellTotals(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/cells');

    const table = page.getByRole('table', { name: 'Cells you oversee' });
    await expect(table.getByRole('columnheader', { name: 'Members' })).toHaveCSS('text-align', 'right');
    await expect(table.getByRole('columnheader', { name: 'Recorded' })).toHaveCSS('text-align', 'right');
    await expect(table.locator('tbody tr').first().locator('td').nth(2)).toHaveCSS('text-align', 'right');
    await expect(table).toHaveCSS('table-layout', 'fixed');
  });

  // The total belongs to Active Cells alone (decision 0366).
  test('the total shows on Active Cells only, and returns with it', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellAdministrator(page);
    await mockCellTotals(page);
    await page.goto('/cells');
    await expect(headline(page)).toBeVisible();

    for (const name of ['Closed Cells', 'Under 3 Members', 'Inactive 3+ Months']) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page).toHaveURL(/view=/);
      await expect(headline(page)).toHaveCount(0);
    }

    await page.getByRole('button', { name: 'Active Cells' }).click();
    await expect(page).not.toHaveURL(/view=/);
    await expect(headline(page)).toBeVisible();
  });

  // The button that brings the whole list back reads Clear search on every list (owner,
  // 2026-10-13).
  test('an emptied box offers Clear search, which brings the whole list back', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellTotals(page);
    await page.goto('/cells');

    await page.getByLabel('Search by Cell ID or leader').fill('youth');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/q=youth/);

    await page.getByLabel('Search by Cell ID or leader').fill('');
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
  });

  test('the header carries New Cell alone, and the line beside the heading', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellApprover(page);
    await mockCellTotals(page);
    await page.goto('/cells');

    const header = page.locator('main > div').first();
    await expect(header.getByRole('heading', { name: 'Cells', exact: true })).toBeVisible();
    await expect(header.getByRole('link')).toHaveText(['New Cell']);
    await expect(header.getByRole('link', { name: 'New Cell' })).toHaveAttribute(
      'href',
      '/cells/new',
    );
  });
});

test.describe('the browser Back button on the Cells list', () => {
  test('steps back through the search and the closed view', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellAdministrator(page);
    await mockCellsWithClosed(page);
    await page.goto('/cells');

    await page.getByLabel('Search by Cell ID or leader').fill('youth');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=youth/);

    await page.getByRole('button', { name: 'Closed Cells' }).click();
    await expect(page).toHaveURL(/view=CLOSED/);

    // A reload keeps both, because they are in the address rather than on the screen.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Closed Cells' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Search by Cell ID or leader')).toHaveValue('youth');
    // Settled before Back: this failed once in a full run and never alone (checklist row
    // test-flaky-cells-back), and Back pressed while the reloaded page still reads is the race.
    await page.waitForLoadState('networkidle');

    await page.goBack();
    await expect(page).not.toHaveURL(/view=CLOSED/);
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
    await page.getByRole('button', { name: 'Search people' }).click();
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
  test('a meeting whose day has not come reads Not yet rather than Not recorded', async ({
    page,
  }) => {
    // 10:00 on 24 June in Manila: the 27 June meeting has no record and its day has not come.
    await page.clock.setFixedTime(new Date('2026-06-24T02:00:00Z'));
    await mockSignedIn(page);
    await mockCellMeetings(page);
    // Change when it meets is offered only with this capability.
    await mockGrants(page, ['cell.manage_configuration']);
    await page.goto(MEETINGS);

    const row = page.getByRole('row').filter({ hasText: 'Saturday 27 June' });
    await expect(row.getByText('Not yet')).toBeVisible();
    await expect(page.getByText('Not recorded').filter({ visible: true })).toHaveCount(0);
  });

  test('a past meeting dated when the Cell had no member reads No members that day', async ({
    page,
  }) => {
    // Decision 0409: not owed and not recorded, so not "Not recorded" either.
    await page.clock.setFixedTime(new Date('2026-06-24T02:00:00Z'));
    await mockSignedIn(page);
    await mockCellMeetings(page);
    await mockGrants(page, []);
    await page.route('**/api/v1/cells/*/meetings?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cell_id: 'CELL-000007',
          category: 'YOUTH',
          day_of_week: 6,
          scheduled_time: '19:00',
          leader: { id: '3f1b7c6e-0000-4000-8000-000000000299', full_name: 'Teofilo Ramos' },
          member_count: 1,
          cell_closed_on: null,
          reporting_month: '2026-06-01',
          scheduled_count: 1,
          recorded_count: 0,
          meetings: [
            {
              scheduled_date: '2026-06-06',
              scheduled_time: '19:00',
              week_starting: '2026-06-01',
              reporting_month: '2026-06-01',
              had_a_member: false,
              meeting: null,
            },
            {
              scheduled_date: '2026-06-13',
              scheduled_time: '19:00',
              week_starting: '2026-06-08',
              reporting_month: '2026-06-01',
              had_a_member: true,
              meeting: null,
            },
          ],
        }),
      }),
    );
    await page.goto(MEETINGS);

    const empty = page.getByRole('row').filter({ hasText: 'Saturday 6 June' });
    await expect(empty.getByText('No members that day')).toBeVisible();
    await expect(empty.getByText('Not recorded')).toHaveCount(0);
    const owed = page.getByRole('row').filter({ hasText: 'Saturday 13 June' });
    await expect(owed.getByText('Not recorded')).toBeVisible();
  });

  test('changes when it meets from the next month, and says so once saved', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-06-24T02:00:00Z'));
    await mockSignedIn(page);
    await mockCellMeetings(page);
    // Change when it meets is offered only with this capability.
    await mockGrants(page, ['cell.manage_configuration']);

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
    await page.getByRole('button', { name: 'Change Schedule' }).click();

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

  test('keeps the month in the address, so Back from elsewhere returns to it', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-06-24T02:00:00Z'));
    await mockSignedIn(page);
    await mockCellMeetings(page);
    // Change when it meets is offered only with this capability.
    await mockGrants(page, ['cell.manage_configuration']);
    await page.goto(MEETINGS);

    await page.getByRole('button', { name: 'Show May 2026' }).click();
    await expect(page).toHaveURL(/month=2026-05-01/);

    await page.goto('/cells');
    await page.goBack();
    await expect(page.getByText('May 2026', { exact: true })).toBeVisible();

    await page.goBack();
    await expect(page.getByText('June 2026', { exact: true })).toBeVisible();
  });

  test('a closed Cell is offered no schedule change', async ({ page }) => {
    await mockSignedIn(page);
    await mockClosedCellMeetings(page);
    await page.goto(MEETINGS);

    await expect(
      page.getByText('CELL-000007 · led by Teofilo Ramos · closed on Saturday 20 June'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Members' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change Schedule' })).toHaveCount(0);
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

    await page.getByRole('button', { name: 'Add Member' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add a member to CELL-000007' });
    await dialog.getByLabel('Search for a person by name').fill('Marilou');
    await dialog.getByRole('button', { name: 'Search people' }).click();
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
    await expect(page.getByRole('button', { name: 'Add Member' })).toBeHidden();
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

test.describe('closed Cells and their restart (decisions 0264 to 0266)', () => {
  test('lists closed Cells in their own view, and sends a restart for approval', async ({
    page,
  }) => {
    await mockSignedIn(page);
    // Closed Cells is the administrator's list (decision 0366).
    await mockCellAdministrator(page);
    await mockCellsWithClosed(page);
    await mockMemberSearch(page);

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
    await page.getByRole('button', { name: 'Closed Cells' }).click();

    const table = page.getByRole('table', { name: 'Closed Cells you oversee' });
    await expect(table.getByRole('columnheader')).toHaveText([
      'Cell',
      'Last leader',
      'Closed',
      'Why',
      'Restart',
    ]);
    const row = table.getByRole('row', { name: /Members dispersed/ });
    await expect(row).toContainText('Paolo Reyes');
    await expect(row).toContainText('12 Jun 2026');
    await expect(row).toContainText('Members dispersed');

    await row.getByRole('button', { name: 'Restart Young Pro · Fri, led by Paolo Reyes' }).click();

    const dialog = page.getByRole('dialog', { name: 'Restart Young Pro · Fri' });
    // Filled in from how it met before, and the leader is a sentence, not a field.
    await expect(dialog.getByText('Paolo Reyes', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Young Pro' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Friday' })).toBeChecked();
    await expect(dialog.getByLabel('What time')).toHaveValue('19:30');

    await dialog.getByRole('radio', { name: 'Saturday' }).check();
    // A restart names three members too (decision 0353).
    await expect(dialog.getByRole('button', { name: 'Send for approval' })).toBeDisabled();
    await chooseThreeMembers(dialog);
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
        members: MEMBER_CHOICES.map((member) => member.id),
      },
    ]);
    await expect(row).toContainText('Sent for approval');
  });

  test('offers no restart where the server says none may be asked for', async ({ page }) => {
    await mockSignedIn(page);
    await mockCellAdministrator(page);
    await mockCellsWithClosed(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/cells');
    await page.getByRole('button', { name: 'Closed Cells' }).click();

    const table = page.getByRole('table', { name: 'Closed Cells you oversee' });
    // The Cell that resumed it is named by category and day, not by its code (decision 0306).
    const restarted = table.getByRole('row', { name: /Restarted as Couple · Wed/ });
    await expect(restarted).toContainText('Restarted as Couple · Wed');
    await expect(restarted).not.toContainText('CELL-000021');
    await expect(restarted.getByRole('button')).toHaveCount(0);

    const inError = table.getByRole('row', { name: /Created in error/ });
    await expect(inError).toContainText('Created in error');
    await expect(inError.getByRole('button')).toHaveCount(0);
  });
});

test.describe('the Cell picker (owner’s choices, 2026-09-21 and 2026-09-30)', () => {
  test('lists the person’s pastoral leader’s Cell first, and finds the rest by search', async ({
    page,
  }) => {
    // Opened from the person's page, which is where a person is added to a Cell (decision
    // 0343). Every Cell in `CELL_CHOICES` is in the person's own Network.
    await mockSignedIn(page);
    await mockPeople(page);
    await mockPersonCells(page, { membership: null, leads: [] });
    await mockCellChoices(page);
    const leaderCell = CELL_CHOICES[1];
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
              id: leaderCell.leader.person_id,
              member_id: leaderCell.leader.member_id,
              full_name: leaderCell.leader.full_name,
              network_root: false,
            },
            {
              id: PERSON_IN_SCOPE.id,
              member_id: PERSON_IN_SCOPE.member_id,
              full_name: PERSON_IN_SCOPE.full_name,
              network_root: false,
            },
          ],
          next_cursor: null,
        }),
      }),
    );

    await page.goto(`/people/${PERSON_IN_SCOPE.id}`);
    await page.getByRole('button', { name: 'Add to Cell' }).click();

    const dialog = page.getByRole('dialog', { name: `Add ${PERSON_IN_SCOPE.full_name} to a Cell` });
    await expect(dialog.getByText('Their leader’s Cell Group — usually the right one', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Choose CELL-/ })).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: `Choose ${leaderCell.cell_id}` })).toBeVisible();
    // Nothing is chosen for them: the leader still picks.
    await expect(dialog.getByRole('button', { name: 'Change Cell Group' })).toHaveCount(0);

    // A search finds the rest, and does not list the leader's Cell twice.
    await searchCells(dialog, 'CELL');
    await expect(dialog.getByRole('button', { name: /^Choose CELL-/ })).toHaveCount(3);
    await expect(dialog.getByRole('button', { name: 'Choose CELL-000007' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: `Choose ${leaderCell.cell_id}` })).toHaveCount(1);
    // ...and says it is listed above (owner, 2026-10-26).
    await expect(
      dialog.getByText(`${leaderCell.leader.full_name}’s Cell Group is listed above.`),
    ).toBeVisible();
  });

  // Owner, 2026-10-26: their leader's Cell was listed but plain, so a leader searched the
  // leader's name and was told no Cell matched, because the search leaves that Cell out.
  test('a search finding only the leader’s Cell says it is listed above, and points to it', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockPersonCells(page, { membership: null, leads: [] });
    await mockCellChoices(page);
    const leaderCell = CELL_CHOICES[1];
    await page.route('**/api/v1/people/*/pastoral-path*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: leaderCell.leader.person_id,
              member_id: leaderCell.leader.member_id,
              full_name: leaderCell.leader.full_name,
              network_root: true,
            },
            {
              id: PERSON_IN_SCOPE.id,
              member_id: PERSON_IN_SCOPE.member_id,
              full_name: PERSON_IN_SCOPE.full_name,
              network_root: false,
            },
          ],
          next_cursor: null,
        }),
      }),
    );

    await page.goto(`/people/${PERSON_IN_SCOPE.id}`);
    await page.getByRole('button', { name: 'Add to Cell' }).click();
    const dialog = page.getByRole('dialog', { name: `Add ${PERSON_IN_SCOPE.full_name} to a Cell` });

    // Set apart: a filled Choose, not the outlined one a search result carries.
    const choose = dialog.getByRole('button', { name: `Choose ${leaderCell.cell_id}` });
    await expect(choose).toBeVisible();
    const filled = await choose.evaluate((el) => getComputedStyle(el).backgroundColor);
    await searchCells(dialog, 'CELL-000007');
    const other = dialog.getByRole('button', { name: 'Choose CELL-000007' });
    await expect(other).toBeVisible();
    expect(await other.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(filled);

    await searchCells(dialog, leaderCell.cell_id);
    await expect(dialog.getByText(/No Cell you oversee matches/)).toHaveCount(0);
    await expect(
      dialog.getByText(`${leaderCell.leader.full_name}’s Cell Group is listed above.`),
    ).toBeVisible();
    await expect(choose).toHaveCount(1);

    await dialog.getByRole('button', { name: 'Show it' }).click();
    await expect(choose).toBeFocused();
  });
});
