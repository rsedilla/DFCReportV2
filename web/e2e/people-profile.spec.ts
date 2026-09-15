import { expect, test, type Page } from '@playwright/test';

import {
  CELL_CHOICES,
  DCC_PAGE_ONE,
  PERSON_IN_SCOPE,
  mockCellChoices,
  mockMembershipAdd,
  mockPeople,
  mockPersonCells,
  mockPersonCreated,
  mockPersonDccRefused,
  mockSignedIn,
} from './mock-api';

/**
 * What the People screens let a leader do with a person's Cell and DCC stage, as opposed to
 * what they look like (decisions 0247 and 0248).
 *
 * `accessibility.spec.ts` scans these states for conformance, and cannot tell whether a
 * removed Sunday is marked, whether a leader is offered a Cell to join, or what a move
 * sends. These cases pin that behaviour.
 */

const PROFILE = `/people/${PERSON_IN_SCOPE.id}`;

async function signedInWithPeople(page: Page) {
  await mockSignedIn(page);
  await mockPeople(page);
}

test.describe('a person’s DCC stage', () => {
  test('shows the stage beside its Sundays, marks a removed one, and loads older Sundays', async ({
    page,
  }) => {
    await signedInWithPeople(page);
    await page.goto(PROFILE);

    await expect(page.getByText('Regular', { exact: true })).toBeVisible();
    await expect(page.getByText('6 Sundays attended')).toBeVisible();
    await expect(page.getByText('Service removed · not counted')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: '2026', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '2025', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Open Sunday/ }).first()).toHaveAttribute(
      'href',
      `/dcc/${DCC_PAGE_ONE.data[0].event_id}`,
    );

    await page.getByRole('button', { name: 'Show older Sundays' }).click();

    await expect(page.getByRole('heading', { name: '2024', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show older Sundays' })).toHaveCount(0);
  });

  test('on a phone, keeps Open Sunday level with the date of a removed Sunday', async ({ page }) => {
    await signedInWithPeople(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PROFILE);

    const row = page.getByRole('listitem').filter({ hasText: 'Service removed · not counted' });
    const link = await row.getByRole('link', { name: /Open Sunday/ }).boundingBox();
    const date = await row.getByText('Sunday 30 August').boundingBox();

    expect(link).not.toBeNull();
    expect(date).not.toBeNull();
    // The link starts no lower than the date, so it is on the row's first line rather than
    // pushed onto a line of its own beneath the tag.
    expect(link!.y).toBeLessThanOrEqual(date!.y);
  });

  test('says plainly when the account may not read it, without the API’s wording', async ({
    page,
  }) => {
    await signedInWithPeople(page);
    await mockPersonDccRefused(page);
    await page.goto(PROFILE);

    await expect(page.getByText('Your account can’t see this person’s DCC attendance.')).toBeVisible();
    await expect(page.getByText('dcc.view_subtree')).toHaveCount(0);
  });
});

test.describe('a person’s Cell', () => {
  test('a leader reads as leading their Cell and is offered no Cell to join', async ({ page }) => {
    await signedInWithPeople(page);
    await mockPersonCells(page, { membership: null, leads: [{ id: CELL_CHOICES[2].id, cell_id: 'C-0014' }] });
    await page.goto(PROFILE);

    await expect(page.getByText('Leads C-0014')).toBeVisible();
    await expect(page.getByText('Not in a Cell.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Move to another Cell' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add to a Cell' })).toHaveCount(0);
  });

  test('a person in no Cell is offered one, which takes effect today', async ({ page }) => {
    await signedInWithPeople(page);
    await mockPersonCells(page, { membership: null, leads: [] });
    await mockCellChoices(page);
    await page.goto(PROFILE);

    await expect(page.getByText('Not in a Cell.')).toBeVisible();
    await page.getByRole('button', { name: 'Add to a Cell' }).click();

    const dialog = page.getByRole('dialog', { name: `Add ${PERSON_IN_SCOPE.full_name} to a Cell` });
    await expect(dialog.getByText('It takes effect today.')).toBeVisible();
  });

  test('moves a member to another Cell in one request, leaving the current Cell off the list', async ({
    page,
  }) => {
    await signedInWithPeople(page);
    await mockCellChoices(page);
    const sent = await mockMembershipAdd(page, 'accepted');

    let cellReads = 0;
    page.on('request', (request) => {
      if (request.method() === 'GET' && request.url().includes('/cells/people/')) {
        cellReads += 1;
      }
    });

    await page.goto(PROFILE);
    await page.getByRole('button', { name: 'Move to another Cell' }).click();

    const dialog = page.getByRole('dialog', {
      name: `Move ${PERSON_IN_SCOPE.full_name} to another Cell`,
    });
    await expect(dialog.getByText('Leaving C-0007, led by Corazon Batac.')).toBeVisible();

    const choice = dialog.getByRole('combobox', { name: 'Cell' });
    await expect(choice.locator('option')).toHaveText(['Choose a Cell', /^C-0011/, /^C-0014/]);

    await choice.selectOption(CELL_CHOICES[1].id);
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();

    await expect(dialog).toBeHidden();
    expect(sent).toEqual([
      {
        path: `/api/v1/cells/${CELL_CHOICES[1].id}/members`,
        body: { person_id: PERSON_IN_SCOPE.id },
      },
    ]);
    await expect.poll(() => cellReads).toBeGreaterThan(1);
  });

  test('a refusal for the other Network names both Networks in plain words', async ({ page }) => {
    await signedInWithPeople(page);
    await mockCellChoices(page);
    await mockMembershipAdd(page, 'other-network');
    await page.goto(PROFILE);

    await page.getByRole('button', { name: 'Move to another Cell' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Cell' }).selectOption(CELL_CHOICES[1].id);
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();

    await expect(
      dialog.getByText(
        'Marilou Reyes Santos is in the Women’s Network and C-0011 is in the Men’s, so they can’t join it.',
      ),
    ).toBeVisible();
    await expect(dialog.getByText('SKILL.md')).toHaveCount(0);
  });
});

test.describe('editing a person', () => {
  test('shows sex without changing it, and says a move is not part of Save', async ({ page }) => {
    await signedInWithPeople(page);
    await page.goto(`${PROFILE}/edit`);

    await expect(page.getByLabel('First name')).toHaveValue('Marilou');
    await expect(page.getByLabel('Last name')).toHaveValue('Santos');
    await expect(page.getByText('Only an Admin can correct this')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Female' })).toHaveCount(0);
    await expect(
      page.getByText('A move is saved as soon as you confirm it. It is not part of Save changes.'),
    ).toBeVisible();
  });
});

test.describe('adding a person with a Cell', () => {
  async function fillTheForm(page: Page) {
    await page.goto('/people/new');
    await page.getByLabel('First name').fill('Marilou');
    await page.getByLabel('Last name').fill('Santos');
    await page.getByRole('radio', { name: 'Female' }).check();
    await page.getByRole('radio', { name: 'Married' }).check();
    await page.getByLabel('Search for a leader by name').fill('an');
    await page.getByRole('button', { name: 'Find' }).click();
    await page.getByRole('button', { name: 'Choose' }).first().click();
  }

  test('places the new person in the chosen Cell once they exist', async ({ page }) => {
    await signedInWithPeople(page);
    await mockCellChoices(page);
    await mockPersonCreated(page);
    const sent = await mockMembershipAdd(page, 'accepted');

    await fillTheForm(page);
    await page.getByRole('combobox', { name: 'Cell' }).selectOption(CELL_CHOICES[1].id);
    await page.getByRole('button', { name: 'Add person' }).click();

    await expect(page).toHaveURL(new RegExp(`${PROFILE}$`));
    expect(sent).toEqual([
      {
        path: `/api/v1/cells/${CELL_CHOICES[1].id}/members`,
        body: { person_id: PERSON_IN_SCOPE.id },
      },
    ]);
  });

  test('adds nobody to a Cell when none is chosen', async ({ page }) => {
    await signedInWithPeople(page);
    await mockCellChoices(page);
    await mockPersonCreated(page);
    const sent = await mockMembershipAdd(page, 'accepted');

    await fillTheForm(page);
    await page.getByRole('button', { name: 'Add person' }).click();

    await expect(page).toHaveURL(new RegExp(`${PROFILE}$`));
    expect(sent).toEqual([]);
  });

  test('says the person was added when the Cell is refused, and why', async ({ page }) => {
    await signedInWithPeople(page);
    await mockCellChoices(page);
    await mockPersonCreated(page);
    await mockMembershipAdd(page, 'other-network');

    await fillTheForm(page);
    await page.getByRole('combobox', { name: 'Cell' }).selectOption(CELL_CHOICES[1].id);
    await page.getByRole('button', { name: 'Add person' }).click();

    await expect(
      page.getByRole('heading', { name: `${PERSON_IN_SCOPE.full_name} was added` }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Marilou Reyes Santos is in the Women’s Network and C-0011 is in the Men’s, so they can’t join it.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open their record' })).toHaveAttribute(
      'href',
      PROFILE,
    );
  });
});
