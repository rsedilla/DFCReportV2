import { expect, test } from '@playwright/test';

import {
  PERSON_IN_SCOPE,
  mockMembershipAdd,
  mockPeople,
  mockPeopleWithoutACell,
  mockSignedIn,
} from './mock-api';
import {
  CELL_WITH_MEETINGS,
  CELL_WITH_NO_SCHEDULE,
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
    await expect(page.getByRole('link', { name: 'People without a Cell' })).toHaveAttribute(
      'href',
      '/cells/people-without-a-cell',
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(table).toBeHidden();
    await expect(page.getByRole('heading', { name: 'CELL-000011' })).toBeVisible();
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
