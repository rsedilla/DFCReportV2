import { expect, test, type Page } from '@playwright/test';

import { PERSON_IN_SCOPE, mockGrants, mockPeople, mockSignedIn } from './mock-api';
import {
  CELL_WITH_MEETINGS,
  mockCellMeetings,
  mockClosedCellMeetings,
  mockPastoralPath,
  mockPastoralPathAtRoot,
} from './mock-attendance';

/**
 * Correct sex on the person page and Change category on the Cell's page (SKILL.md sections 4
 * and 10, decision 0367). The API decides whether either is allowed; these cases pin what the
 * screens offer, say first and send. Invented people throughout.
 */

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

const PROFILE = `/people/${PERSON_IN_SCOPE.id}`;

const MENS_LEADER = {
  scope: 'IDENTITY_ONLY',
  id: '11111111-2222-4333-8444-000000000881',
  member_id: 'M-000881',
  full_name: 'Rodel Bautista',
  sex: 'MALE',
  network: 'MENS',
  direct_leader_name: null,
};

/** The administrator: `people.correct_sex` and backdating, both at Whole Church. */
async function mockAdministrator(page: Page) {
  const grant = (capability: string) => ({
    capability,
    scope_type: 'WHOLE_CHURCH',
    scope_network: null,
    read_only: false,
    source: 'ROLE',
  });
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill(
      json({
        account_id: '4f8c1d6a-0f1e-4b2a-9c3d-5e6f7a8b9c0d',
        person_id: '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9',
        email: 'admin@example.invalid',
        first_name: 'Marilou',
        roles: ['ADMIN'],
        screens: 'FULL',
        people_i_oversee: true,
        capabilities: [
          grant('people.view_subtree'),
          grant('people.edit_basic'),
          grant('people.correct_sex'),
          grant('records.backdate_effective_date'),
        ],
      }),
    ),
  );
}

/** Their direct disciples, for the dialog's first read, and the leader search it makes. */
async function mockBranchAndSearch(page: Page, disciples: { id: string; full_name: string }[] = []) {
  await page.route('**/api/v1/leaders/*/children*', (route) =>
    route.fulfill(
      json({
        person: {
          id: PERSON_IN_SCOPE.id,
          member_id: PERSON_IN_SCOPE.member_id,
          full_name: PERSON_IN_SCOPE.full_name,
          leads_anyone: disciples.length > 0,
          direct_reports: disciples.length,
          beneath: disciples.length,
        },
        data: disciples.map((disciple, n) => ({
          ...disciple,
          member_id: `M-00090${n}`,
          leads_anyone: false,
          direct_reports: 0,
          beneath: 0,
        })),
        next_cursor: null,
      }),
    ),
  );
  // The leader search is the one narrowed to the new Network (decision 0299), so it is told
  // from the other reads by that.
  await page.route('**/api/v1/people?*', (route) =>
    new URL(route.request().url()).searchParams.get('network') === 'MENS'
      ? route.fulfill(json({ data: [MENS_LEADER], next_cursor: null }))
      : route.fallback(),
  );
}

test.describe('Correct sex (decision 0367)', () => {
  test('is not offered to an account that may not correct a sex', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockPastoralPath(page);
    await page.goto(PROFILE);

    await expect(page.getByRole('heading', { name: PERSON_IN_SCOPE.full_name })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Correct sex' })).toHaveCount(0);
  });

  test('states the change, asks for a reason and a leader in the new Network, and sends them', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockPastoralPath(page);
    await mockAdministrator(page);
    await mockBranchAndSearch(page);
    const sent: unknown[] = [];
    await page.route(`**/api/v1/people/${PERSON_IN_SCOPE.id}/sex`, (route) => {
      sent.push(route.request().postDataJSON());
      return route.fulfill(json({ ...PERSON_IN_SCOPE, sex: 'MALE', network: 'MENS' }));
    });
    const searches: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/people?')) {
        searches.push(request.url());
      }
    });
    await page.goto(PROFILE);

    await page.getByRole('button', { name: 'Correct sex' }).click();
    const dialog = page.getByRole('dialog', { name: `Correct ${PERSON_IN_SCOPE.full_name}’s sex` });
    await expect(dialog).toContainText('Female, Women’s Network → Male, Men’s Network');
    await expect(dialog).toContainText('Needed because Teofilo Ramos, who pastors them now');

    const submit = dialog.getByRole('button', { name: 'Correct to Male' });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('Why is it being corrected? (required)').fill('Entered as female by mistake');
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('Search for a leader by name').fill('Rodel');
    await dialog.getByRole('button', { name: 'Search people' }).click();
    await dialog.getByRole('button', { name: 'Choose' }).first().click();
    // An earlier date is offered to an account that may backdate, and blank means now.
    await expect(dialog.getByLabel('As of an earlier date (optional)')).toHaveValue('');
    await submit.click();

    await expect(dialog).toBeHidden();
    expect(sent).toEqual([
      { sex: 'MALE', reason: 'Entered as female by mistake', pastoral_leader_id: MENS_LEADER.id },
    ]);
    // An administrator's picker asks for the directory itself, so decision 0303's bound and
    // audit entry apply to it (decision 0389).
    expect(searches.length).toBeGreaterThan(0);
    for (const url of searches) {
      expect(new URL(url).searchParams.get('church_wide')).toBe('true');
    }
  });

  test('says a Network root is not corrected here, and offers no form', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockPastoralPathAtRoot(page);
    await mockAdministrator(page);
    await mockBranchAndSearch(page);
    await page.goto(PROFILE);

    await page.getByRole('button', { name: 'Correct sex' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('is a Network root');
    await expect(dialog.getByRole('button', { name: /^Correct to/ })).toHaveCount(0);
  });

  test('names the people they lead, to be moved first', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockPastoralPath(page);
    await mockAdministrator(page);
    await mockBranchAndSearch(page, [
      { id: '11111111-2222-4333-8444-000000000891', full_name: 'Nenita Garcia' },
    ]);
    await page.goto(PROFILE);

    await page.getByRole('button', { name: 'Correct sex' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Move them first');
    await expect(dialog.getByRole('link', { name: 'Nenita Garcia' })).toHaveAttribute(
      'href',
      '/people/11111111-2222-4333-8444-000000000891',
    );
    await expect(dialog.getByRole('button', { name: /^Correct to/ })).toHaveCount(0);
  });

  test('shows a refusal with whoever it names', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockPastoralPath(page);
    await mockAdministrator(page);
    await mockBranchAndSearch(page);
    await page.route(`**/api/v1/people/${PERSON_IN_SCOPE.id}/sex`, (route) =>
      route.fulfill(
        json(
          {
            error: {
              code: 'INVARIANT_VIOLATION',
              message:
                'That person still leads other people. Reassign each of them to another leader first, then make this change.',
              details: {
                disciples: [
                  { id: '11111111-2222-4333-8444-000000000892', member_id: 'M-000892', full_name: 'Lorna Pascual' },
                ],
              },
            },
          },
          409,
        ),
      ),
    );
    await page.goto(PROFILE);

    await page.getByRole('button', { name: 'Correct sex' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Why is it being corrected? (required)').fill('Entered as female by mistake');
    await dialog.getByLabel('Search for a leader by name').fill('Rodel');
    await dialog.getByRole('button', { name: 'Search people' }).click();
    await dialog.getByRole('button', { name: 'Choose' }).first().click();
    await dialog.getByRole('button', { name: 'Correct to Male' }).click();

    await expect(dialog).toContainText('still leads other people');
    await expect(dialog.getByRole('link', { name: 'Lorna Pascual' })).toBeVisible();
  });
});

test.describe('Change category (decision 0367)', () => {
  const MEETINGS = `/cells/${CELL_WITH_MEETINGS.id}/meetings`;

  test('sits beside Change when it meets, offers the other categories, and says today', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellMeetings(page);
    // Change when it meets is offered only with this capability.
    await mockGrants(page, ['cell.manage_configuration']);
    const sent: unknown[] = [];
    await page.route('**/api/v1/cells/*/category', (route) => {
      sent.push(route.request().postDataJSON());
      return route.fulfill(json({ id: CELL_WITH_MEETINGS.id, category: 'COUPLE' }));
    });
    await page.goto(MEETINGS);

    await expect(page.getByRole('button', { name: 'Change when it meets' })).toBeVisible();
    await page.getByRole('button', { name: 'Change category' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('It is a Youth Cell now.');
    await expect(dialog.getByRole('radio')).toHaveCount(2);
    await expect(dialog.getByRole('radio', { name: 'Youth' })).toHaveCount(0);
    await expect(dialog).toContainText('It takes effect today.');

    await dialog.getByRole('radio', { name: 'Couple' }).check();
    await dialog.getByRole('button', { name: 'Make it Couple' }).click();

    await expect(dialog).toBeHidden();
    expect(sent).toEqual([{ category: 'COUPLE' }]);
    await expect(page.getByText('Saved. It is a Couple Cell from today.')).toBeVisible();
  });

  test('is not offered for a closed Cell', async ({ page }) => {
    await mockSignedIn(page);
    await mockClosedCellMeetings(page);
    await page.goto(MEETINGS);

    await expect(page.getByRole('link', { name: 'Members' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change category' })).toHaveCount(0);
  });
});
