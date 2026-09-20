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
