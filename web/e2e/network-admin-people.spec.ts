import { expect, test, type Page } from '@playwright/test';

import { mockAbsentPeople, mockPeople, mockSignedIn, PERSON_IN_SCOPE } from './mock-api';
import { mockPastoralPath } from './mock-attendance';

/**
 * The Network Admin's people powers on a person's page (SKILL.md sections 7 and 19, decision
 * 0469): edit, move and archive in their own Network, and none of them on a record only the
 * Admin changes. Every name and figure is invented.
 */

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const held = (capability: string) => ({
  capability,
  scope_type: 'NETWORK',
  scope_network: 'WOMENS',
  read_only: null,
  source: 'role',
});

async function mockNetworkAdmin(page: Page): Promise<void> {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill(
      json({
        account_id: '3f1b7c6e-0000-4000-8000-000000000e01',
        person_id: '3f1b7c6e-0000-4000-8000-000000000e02',
        email: 'nora@example.test',
        username: null,
        first_name: 'Nora',
        roles: ['NETWORK_ADMIN'],
        screens: 'FULL',
        people_i_oversee: true,
        capabilities: [
          'people.view_subtree',
          'people.create',
          'people.edit_basic',
          'people.manage_lifecycle',
          'people.manage_pastoral_assignment',
          'dcc.view_subtree',
          'cell.view_subtree',
          'reports.view_subtree',
          'accounts.manage',
          'roles.manage',
        ].map(held),
      }),
    ),
  );
}

async function open(page: Page, person: Record<string, unknown>, view = ''): Promise<void> {
  await mockSignedIn(page);
  await mockPeople(page);
  await mockPastoralPath(page);
  await mockNetworkAdmin(page);
  await page.route(`**/api/v1/people/${PERSON_IN_SCOPE.id}`, (route) =>
    route.fulfill(json({ ...PERSON_IN_SCOPE, archived: null, pastors: 0, ...person })),
  );
  await page.route(`**/api/v1/accounts/for-person/${PERSON_IN_SCOPE.id}`, (route) =>
    route.fulfill(json({ account: null })),
  );
  await page.goto(`/people/${PERSON_IN_SCOPE.id}${view}`);
  await expect(page.getByRole('heading', { name: PERSON_IN_SCOPE.full_name })).toBeVisible();
}

test.describe('a person of the Network Admin’s Network', () => {
  test('offers Edit details and Change Leader', async ({ page }) => {
    await open(page, { read_only: false });

    await expect(page.getByRole('link', { name: 'Edit details' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change Leader' })).toBeVisible();
    await expect(page.getByText('Changes to this record are made by the Admin.')).toHaveCount(0);
  });

  test('offers Archive on the Account view', async ({ page }) => {
    await open(page, { read_only: false }, '?view=account');

    await expect(page.getByRole('button', { name: /^Archive/ })).toBeVisible();
  });
});

test.describe('a record only the Admin changes', () => {
  test('offers no edit and no move, and says who changes it', async ({ page }) => {
    await open(page, { read_only: true });

    await expect(page.getByText('Changes to this record are made by the Admin.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit details' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change Leader' })).toHaveCount(0);
  });

  test('offers no Archive', async ({ page }) => {
    await open(page, { read_only: true }, '?view=account');

    await expect(page.getByText('Changes to this record are made by the Admin.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Archive/ })).toHaveCount(0);
  });
});

test.describe('Absent 3+ Months for a Network Admin', () => {
  test('offers Archive on a row', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockAbsentPeople(page);
    await mockNetworkAdmin(page);
    await page.goto('/people/absent');

    const table = page.getByRole('table', { name: 'Absent 3+ Months' });
    await expect(table.getByRole('button', { name: /^Archive/ }).first()).toBeVisible();
  });

  test('says who changes a row only the Admin changes', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockNetworkAdmin(page);
    await page.route('**/api/v1/people/absent*', (route) =>
      route.fulfill(
        json({
          months: ['2026-03', '2026-04', '2026-05'],
          data: [
            {
              id: '3f1b7c6e-0000-4000-8000-000000000961',
              member_id: 'M-001061',
              full_name: 'Amparo Villar',
              leader: null,
              cell: null,
              leads: [],
              pastors: 0,
              last_at_cell: null,
              last_at_dcc: '2026-02-08',
              read_only: true,
            },
          ],
          next_cursor: null,
        }),
      ),
    );
    await page.goto('/people/absent');

    const table = page.getByRole('table', { name: 'Absent 3+ Months' });
    await expect(table.getByText('Changed by the Admin')).toBeVisible();
    await expect(table.getByRole('button', { name: /^Archive/ })).toHaveCount(0);
  });
});
