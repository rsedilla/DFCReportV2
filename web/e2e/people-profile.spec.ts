import { expect, test, type Page } from '@playwright/test';

import {
  CELL_CHOICES,
  DCC_PAGE_ONE,
  MENS_CELL_CHOICE,
  PERSON_IN_SCOPE,
  PERSON_WITHHELD,
  SIGNED_IN_PERSON_ID,
  mockCellChoices,
  mockGrants,
  mockMembershipAdd,
  mockPeople,
  mockPersonCells,
  mockPersonCreated,
  mockPersonDccRefused,
  mockSignedIn,
  mockWithoutEditBasic,
} from './mock-api';
import { mockPastoralPath } from './mock-attendance';

/** The direct leader in `mockPastoralPath`: the entry above the person. */
const PATH_LEADER = { id: '3f1b7c6e-0000-4000-8000-000000000902', full_name: 'Teofilo Ramos' };

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

test.describe('why a person has no pastoral leader (decision 0270)', () => {
  for (const [reason, words] of [
    ['OUTSIDE_TREE', 'Outside the pastoral tree'],
    ['ARCHIVED', 'Archived'],
    [null, 'No pastoral leader yet'],
  ] as const) {
    test(`says "${words}" where the server answers ${String(reason)}`, async ({ page }) => {
      await signedInWithPeople(page);
      await page.route(`**/api/v1/people/${PERSON_IN_SCOPE.id}/pastoral-path*`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: PERSON_IN_SCOPE.id,
                member_id: PERSON_IN_SCOPE.member_id,
                full_name: PERSON_IN_SCOPE.full_name,
                network_root: false,
              },
            ],
            next_cursor: null,
            no_leader_reason: reason,
          }),
        }),
      );

      await page.goto(PROFILE);

      await expect(page.getByText(words, { exact: true })).toBeVisible();
    });
  }
});

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

  // Decision 0260: this month's Sundays attended out of section 9's N, and last month's.
  test('leads with the stage and the month’s Sundays attended out of section 9’s N', async ({
    page,
  }) => {
    // Saturday 19 September in Manila, so the 20th has not begun.
    await page.clock.setFixedTime(new Date('2026-09-19T02:00:00Z'));
    await signedInWithPeople(page);
    await page.route('**/api/v1/dcc/events?*', (route) => {
      const month = new URL(route.request().url()).searchParams.get('month') ?? '';
      const event = (date: string, reason: string | null) => ({
        id: `6b000000-0000-4000-8000-0000000${date.replaceAll('-', '').slice(3)}`,
        event_date: date,
        recordable: reason === null && !date.startsWith('2026-08'),
        // August closed on 7 September, so a held August Sunday is refused as MONTH_CLOSED.
        not_recordable_reason: reason ?? (date.startsWith('2026-08') ? 'MONTH_CLOSED' : null),
        removed: reason === 'REMOVED',
        removal_reason: reason === 'REMOVED' ? 'Combined service.' : null,
        coverage: null,
      });
      const data = month.startsWith('2026-09')
        ? [
            event('2026-09-06', null),
            event('2026-09-13', null),
            event('2026-09-20', 'NOT_YET_HELD'),
            event('2026-09-27', 'NOT_YET_HELD'),
          ]
        : [
            event('2026-08-02', null),
            event('2026-08-09', null),
            event('2026-08-16', null),
            event('2026-08-23', null),
            event('2026-08-30', 'REMOVED'),
          ];
      return route.fulfill({ json: { reporting_month: month, open: month.startsWith('2026-09'), data } });
    });

    await page.goto(PROFILE);

    // N counts every Sunday not removed, the 20th and 27th included, as the report does.
    await expect(page.getByText('1 of 4', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Open until 7 October')).toBeVisible();
    await expect(page.getByText('August: 1 of 4', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent Sundays' })).toBeVisible();
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
    await mockPersonCells(page, { membership: null, leads: [{ id: CELL_CHOICES[2].id, cell_id: 'CELL-000014' }] });
    await page.goto(PROFILE);

    await expect(page.getByText('Leads CELL-000014', { exact: true })).toBeVisible();
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
    await expect(dialog.getByText('Leaving CELL-000007, led by Corazon Batac.')).toBeVisible();

    const choice = dialog.getByRole('combobox', { name: 'Cell' });
    await expect(choice.locator('option')).toHaveText(['Choose a Cell', /^CELL-000011/, /^CELL-000014/]);

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

  test('offers only the person’s own Network’s Cells, and says why (owner’s choice, 2026-09-21)', async ({
    page,
  }) => {
    await signedInWithPeople(page);
    await mockCellChoices(page, [MENS_CELL_CHOICE]);
    await page.goto(PROFILE);

    await page.getByRole('button', { name: 'Move to another Cell' }).click();
    const dialog = page.getByRole('dialog');
    const choice = dialog.getByRole('combobox', { name: 'Cell' });

    // Marilou is FEMALE, so the Men's Network Cell is not offered; section 10 would refuse it.
    await expect(choice.locator('option')).toHaveText(['Choose a Cell', /^CELL-000011/, /^CELL-000014/]);
    await expect(
      dialog.getByText('Only Women\'s Network Cells are listed: a member and their Cell’s leader share one Network.'),
    ).toBeVisible();
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
        'Marilou Reyes Santos is in the Women’s Network and CELL-000011 is in the Men’s, so they can’t join it.',
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

  test('shows the pastoral leader read-only and points to the move on the profile', async ({
    page,
  }) => {
    await signedInWithPeople(page);
    await mockPastoralPath(page);
    await page.goto(`${PROFILE}/edit`);

    await expect(page.getByText(PATH_LEADER.full_name, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: PATH_LEADER.full_name })).toHaveCount(0);
    await expect(
      page.getByText('Changing it is a move, not an edit. Use Move to another leader on the profile.'),
    ).toBeVisible();
  });

  test('one Save shows the change on the profile at once', async ({ page }) => {
    // The server holds what was last saved, so a profile showing its older cached copy fails.
    await signedInWithPeople(page);
    let current: Record<string, unknown> = { ...PERSON_IN_SCOPE };
    await page.route(`**/api/v1/people/${PERSON_IN_SCOPE.id}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        current = { ...current, ...route.request().postDataJSON() };
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(current),
      });
    });

    await page.goto(PROFILE);
    const title = page.locator('dt', { hasText: /^Title$/ }).locator('+ dd');
    await expect(title).toHaveText('—');

    await page.getByRole('link', { name: 'Edit details' }).click();
    await page.getByLabel('Title').fill('Pastor');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page).toHaveURL(PROFILE);
    await expect(title).toHaveText('Pastor');
  });
});

test.describe('who pastors a person', () => {
  test('names the leader under the name, linking to their record', async ({ page }) => {
    await signedInWithPeople(page);
    await mockPastoralPath(page);
    await page.goto(PROFILE);

    await expect(page.getByText(/^Pastored by/)).toBeVisible();
    await expect(page.getByRole('link', { name: PATH_LEADER.full_name })).toHaveAttribute(
      'href',
      `/people/${PATH_LEADER.id}`,
    );
  });

  test('moves them under a chosen leader, with the reason, from a dialog on the profile', async ({
    page,
  }) => {
    await signedInWithPeople(page);
    await mockGrants(page, ['people.manage_pastoral_assignment']);
    await mockPastoralPath(page);

    const sent: unknown[] = [];
    await page.route('**/api/v1/people/*/pastoral-leader', async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto(PROFILE);
    await page.getByRole('button', { name: 'Move to another leader' }).click();

    const dialog = page.getByRole('dialog', {
      name: `Move ${PERSON_IN_SCOPE.full_name} to another leader`,
    });
    await expect(dialog.getByText(`Pastored now by ${PATH_LEADER.full_name}.`)).toBeVisible();

    await dialog.getByLabel('Search for a leader by name').fill('an');
    await dialog.getByRole('button', { name: 'Find' }).click();
    await dialog.getByRole('button', { name: 'Choose' }).nth(1).click();
    await dialog.getByLabel('Why is this changing? (optional)').fill('Moved to a nearer leader');
    await dialog.getByRole('button', { name: `Move under ${PERSON_WITHHELD.full_name}` }).click();

    await expect(dialog).toBeHidden();
    expect(sent).toEqual([
      { pastoral_leader_id: PERSON_WITHHELD.id, reason: 'Moved to a nearer leader' },
    ]);
  });

  test('offers no move to an account that may not move people', async ({ page }) => {
    await signedInWithPeople(page);
    await mockPastoralPath(page);
    await page.goto(PROFILE);

    await expect(page.getByRole('link', { name: 'Edit details' })).toBeVisible();
    await expect(page.getByRole('link', { name: PATH_LEADER.full_name })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Move to another leader' })).toHaveCount(0);
  });

  test('on your own profile, names your leader without a link and offers no move', async ({
    page,
  }) => {
    await signedInWithPeople(page);
    await mockGrants(page, ['people.manage_pastoral_assignment']);
    await mockPastoralPath(page);
    await page.route(`**/api/v1/people/${SIGNED_IN_PERSON_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...PERSON_IN_SCOPE, id: SIGNED_IN_PERSON_ID }),
      }),
    );

    await page.goto(`/people/${SIGNED_IN_PERSON_ID}`);

    // The link disappearing is what says the account has loaded, so the button's absence
    // below is measured against a loaded account rather than before it arrives.
    await expect(page.getByText(PATH_LEADER.full_name, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: PATH_LEADER.full_name })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Move to another leader' })).toHaveCount(0);
  });

  test('a record outside your scope is refused in plain words, without the API’s', async ({
    page,
  }) => {
    await signedInWithPeople(page);
    await page.route(`**/api/v1/people/${PERSON_WITHHELD.id}`, (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'SCOPE_DENIED',
            message: 'You hold people.view_subtree, but not over this record.',
            details: {},
          },
        }),
      }),
    );

    await page.goto(`/people/${PERSON_WITHHELD.id}`);

    await expect(
      page.getByText(
        'This person is not one of the people you oversee, so their details are not shown to you.',
      ),
    ).toBeVisible();
    await expect(page.getByText(/ask one of those leaders/)).toBeVisible();
    await expect(page.getByText('people.view_subtree')).toHaveCount(0);
  });
});

test.describe('dialogs', () => {
  test('rise from the bottom edge on a phone and sit centred on a desktop', async ({ page }) => {
    await signedInWithPeople(page);
    await mockCellChoices(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PROFILE);
    await page.getByRole('button', { name: 'Move to another Cell' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('combobox', { name: 'Cell' })).toBeVisible();
    const sheet = await dialog.boundingBox();
    expect(sheet).not.toBeNull();
    expect(sheet!.y + sheet!.height).toBeGreaterThanOrEqual(843);
    expect(sheet!.width).toBeGreaterThanOrEqual(389);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: 'Move to another Cell' }).click();
    await expect(dialog.getByRole('combobox', { name: 'Cell' })).toBeVisible();
    const centred = await dialog.boundingBox();
    expect(centred).not.toBeNull();
    expect(centred!.y + centred!.height).toBeLessThan(790);
    expect(centred!.x).toBeGreaterThan(100);
  });
});

// Owner's design adjusted (2026-09-19): the adder starts as the leader where they hold an
// assignment, and a stage is shown and never set by hand.
test.describe('the Add and Edit person forms', () => {
  test('start the pastoral leader as the person adding', async ({
    page,
  }) => {
    await signedInWithPeople(page);
    await mockPastoralPath(page);
    // The adder's own record, which says which Network they lead in (sections 4 and 5).
    await page.route(`**/api/v1/people/${SIGNED_IN_PERSON_ID}`, (route) =>
      route.fulfill({ json: { ...PERSON_IN_SCOPE, id: SIGNED_IN_PERSON_ID, sex: 'FEMALE' } }),
    );
    await page.goto('/people/new');

    await expect(page.getByText('Rosalinda Ocampo (you)')).toBeVisible();
    await expect(page.getByText('None yet — it’s worked out from their Sundays.')).toBeVisible();

    // A man cannot be led from the Women's Network, so the default is withdrawn.
    await page.getByRole('radio', { name: 'Male', exact: true }).check();
    await expect(page.getByText('Rosalinda Ocampo (you)')).toHaveCount(0);
  });

  test('shows the journey stage on the edit form without offering to change it', async ({
    page,
  }) => {
    await signedInWithPeople(page);
    await mockPastoralPath(page);
    await page.goto(`${PROFILE}/edit`);

    await expect(page.getByText('Journey stage')).toBeVisible();
    await expect(page.getByText('Regular', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Correct this stage/ })).toHaveCount(0);
  });

  test('sends a title apart from the name (decision 0271)', async ({ page }) => {
    await signedInWithPeople(page);
    await mockPastoralPath(page);

    const sent: Record<string, unknown>[] = [];
    await page.route(`**/api/v1/people/${PERSON_IN_SCOPE.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') {
        return route.fallback();
      }
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...PERSON_IN_SCOPE, title: 'Bishop' }),
      });
    });

    await page.goto(`${PROFILE}/edit`);
    await page.getByLabel('Title, optional').fill('Bishop');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page).toHaveURL(new RegExp(`${PROFILE}$`));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: 'Bishop', first_name: PERSON_IN_SCOPE.first_name });
  });
});

test.describe('a detail that is not recorded (decision 0272)', () => {
  async function withNothingRecorded(page: Page) {
    await signedInWithPeople(page);
    await mockPastoralPath(page);
    await page.route(`**/api/v1/people/${PERSON_IN_SCOPE.id}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...PERSON_IN_SCOPE, birth_date: null, mobile_number: null }),
      }),
    );
  }

  test('offers to add it, and the edit form opens on that field', async ({ page }) => {
    await withNothingRecorded(page);
    await page.goto(PROFILE);

    await expect(page.getByRole('link', { name: 'Add a mobile number' })).toHaveAttribute(
      'href',
      `${PROFILE}/edit#mobile_number`,
    );
    await page.getByRole('link', { name: 'Add a birthday' }).click();

    await expect(page).toHaveURL(new RegExp(`${PROFILE}/edit#birth_date$`));
    await expect(page.locator('input[name="birth_date"]')).toBeFocused();
  });

  test('offers nothing to a reader who may not edit the person', async ({ page }) => {
    await withNothingRecorded(page);
    await mockWithoutEditBasic(page);
    await page.goto(PROFILE);

    await expect(page.getByText('Not recorded').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /^Add a/ })).toHaveCount(0);
  });
});

test.describe("a person's account, for an administrator (decision 0276)", () => {
  const ACCOUNT_ROUTE = `**/api/v1/accounts/for-person/${PERSON_IN_SCOPE.id}`;

  test('is not shown to a reader without accounts.manage', async ({ page }) => {
    await signedInWithPeople(page);
    await mockPastoralPath(page);
    await page.goto(PROFILE);

    await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Account/ })).toHaveCount(0);
  });

  test('gives an account with an email and a role', async ({ page }) => {
    await signedInWithPeople(page);
    await mockGrants(page, ['accounts.manage']);
    await mockPastoralPath(page);
    await page.route(ACCOUNT_ROUTE, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"account":null}' }),
    );
    const sent: unknown[] = [];
    await page.route('**/api/v1/accounts', async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    });

    await page.goto(PROFILE);
    await expect(page.getByText('No account. Marilou cannot sign in.')).toBeVisible();
    await page.getByRole('button', { name: 'Give Marilou an account' }).click();
    await page.getByLabel('Email address').fill('marilou@example.test');
    await page.getByRole('radio', { name: 'Senior Pastor' }).check();
    await page.getByRole('button', { name: 'Create and send the activation email' }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({
      person_id: PERSON_IN_SCOPE.id,
      email: 'marilou@example.test',
      role: 'SENIOR_PASTOR',
    });
  });

  test('resends the activation email while the account waits', async ({ page }) => {
    await signedInWithPeople(page);
    await mockGrants(page, ['accounts.manage']);
    await mockPastoralPath(page);
    const accountId = '3f1b7c6e-0000-4000-8000-000000000901';
    await page.route(ACCOUNT_ROUTE, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          account: {
            id: accountId,
            email: 'marilou@example.test',
            status: 'PENDING_ACTIVATION',
            roles: ['LEADER'],
            created_at: '2026-09-22T02:00:00.000Z',
          },
        }),
      }),
    );
    const resent: string[] = [];
    await page.route('**/api/v1/accounts/*/activation-email', async (route) => {
      resent.push(new URL(route.request().url()).pathname);
      await route.fulfill({ status: 204 });
    });

    await page.goto(PROFILE);
    await expect(page.getByText('Waiting for activation')).toBeVisible();
    await page.getByRole('button', { name: 'Resend the activation email' }).click();

    await expect(page.getByText('Sent to marilou@example.test.')).toBeVisible();
    expect(resent).toEqual([`/api/v1/accounts/${accountId}/activation-email`]);
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
    await page.getByRole('button', { name: 'Add this person' }).click();

    await expect(page).toHaveURL(new RegExp(`${PROFILE}$`));
    expect(sent).toEqual([
      {
        path: `/api/v1/cells/${CELL_CHOICES[1].id}/members`,
        body: { person_id: PERSON_IN_SCOPE.id },
      },
    ]);
  });

  test('narrows the Cells to the Network the chosen sex assigns', async ({ page }) => {
    await signedInWithPeople(page);
    await mockCellChoices(page, [MENS_CELL_CHOICE]);

    await fillTheForm(page);
    const cell = page.getByRole('combobox', { name: 'Cell' });
    await expect(cell.locator('option', { hasText: 'CELL-000019' })).toHaveCount(0);

    // A Cell chosen and then narrowed away is no longer chosen.
    await cell.selectOption(CELL_CHOICES[1].id);
    await page.getByRole('radio', { name: 'Male', exact: true }).check();
    await expect(cell.locator('option', { hasText: 'CELL-000019' })).toHaveCount(1);
    await expect(cell).toHaveValue('');
  });

  test('adds nobody to a Cell when none is chosen', async ({ page }) => {
    await signedInWithPeople(page);
    await mockCellChoices(page);
    await mockPersonCreated(page);
    const sent = await mockMembershipAdd(page, 'accepted');

    await fillTheForm(page);
    await page.getByRole('button', { name: 'Add this person' }).click();

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
    await page.getByRole('button', { name: 'Add this person' }).click();

    await expect(
      page.getByRole('heading', { name: `${PERSON_IN_SCOPE.full_name} was added` }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Marilou Reyes Santos is in the Women’s Network and CELL-000011 is in the Men’s, so they can’t join it.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open their record' })).toHaveAttribute(
      'href',
      PROFILE,
    );
  });
});
