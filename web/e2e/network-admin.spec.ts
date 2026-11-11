import { expect, test, type Page } from '@playwright/test';

import {
  mockAccountsAdministrator,
  mockAdminArea,
  mockPeople,
  mockSignedIn,
} from './mock-api';
import { mockCellReport, mockCellTwelve } from './mock-attendance';
import { SP_PRIMARIES, SP_WOMENS_ROOT } from './mock-senior-pastor';

/**
 * The Network Admin, stage 1 (SKILL.md sections 7 and 19, decision 0469): the whole-church
 * Admin's one form, and a Network Admin's Reports showing their own Network. Every name and
 * figure is invented.
 */

const read = (capability: string) => ({
  capability,
  scope_type: 'NETWORK',
  scope_network: 'WOMENS',
  read_only: null,
  source: 'role',
});

/** A Network Admin's session: reads across the Women's Network, and no write. */
async function mockNetworkAdmin(page: Page): Promise<void> {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
          'dcc.view_subtree',
          'cell.view_subtree',
          'reports.view_subtree',
          'conquest.view_subtree',
          'suynl.view_subtree',
          'training.view_subtree',
        ].map(read),
      }),
    }),
  );
}

const figures = {
  cell_groups: 2,
  j12_kids: 0,
  youth: 1,
  young_pro: 1,
  couple: 0,
  cell_leaders: 2,
  people: 16,
};

async function mockNetworkCounts(page: Page): Promise<void> {
  await page.route('**/api/v1/reports/church-counts?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        period: '2026-10-01',
        current: true,
        at: '2026-10-08T02:00:00.000Z',
        network: 'WOMENS',
        whole_church: figures,
        tables: [
          {
            root: SP_WOMENS_ROOT,
            network: 'WOMENS',
            rows: [{ leader: SP_PRIMARIES.bautista, ...figures }],
          },
        ],
        others: { ...figures, cell_groups: 0, youth: 0, young_pro: 0, cell_leaders: 0, people: 0 },
      }),
    }),
  );
}

test.describe('the one form', () => {
  test('is offered on Accounts and asks for an email and no leader', async ({ page }) => {
    await mockSignedIn(page);
    await mockAccountsAdministrator(page);
    await mockAdminArea(page);
    await mockPeople(page);

    await page.goto('/admin?tab=accounts');
    await page.getByRole('link', { name: 'Add a Network Admin' }).click();

    await expect(page.getByRole('heading', { name: 'Add a Network Admin' })).toBeVisible();
    await expect(page.getByLabel('Email address (required)')).toBeVisible();
    await expect(page.getByText('Their leader')).toHaveCount(0);
    await expect(page.getByText('Their Cell Group')).toHaveCount(0);
  });

  test('sends the person and the email to its own route', async ({ page }) => {
    await mockSignedIn(page);
    await mockAccountsAdministrator(page);
    await mockPeople(page);
    const sent: Record<string, unknown>[] = [];
    await page.route('**/api/v1/accounts/network-admin', async (route) => {
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'a', person_id: '3f1b7c6e-0000-4000-8000-000000000e03' }),
      });
    });

    await page.goto('/people/new?as=network-admin');
    await page.getByLabel('First name').fill('Naomi');
    await page.getByLabel('Last name').fill('Fixtureson');
    await page.getByRole('radio', { name: 'Female' }).check();
    await page.getByRole('radio', { name: 'Single' }).check();
    await page.getByRole('checkbox', { name: 'Not given yet' }).first().check();
    await page.getByRole('checkbox', { name: 'Not given yet' }).last().check();
    await page.getByLabel('Email address (required)').fill('naomi@example.test');
    await page.getByRole('button', { name: 'Add and send activation email' }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ first_name: 'Naomi', email: 'naomi@example.test' });
    expect(sent[0]).not.toHaveProperty('pastoral_leader_id');
  });

  test('is an ordinary Add a person for anybody without accounts.manage', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);

    await page.goto('/people/new?as=network-admin');

    await expect(page.getByRole('heading', { name: 'Add a person' })).toBeVisible();
    await expect(page.getByLabel('Email address (required)')).toHaveCount(0);
  });
});

test.describe("a Network Admin's reports", () => {
  test('heads the counts with their Network', async ({ page }) => {
    await mockSignedIn(page);
    await mockNetworkAdmin(page);
    await mockNetworkCounts(page);

    await page.goto('/reports/number-of-cells');

    await expect(page.getByRole('heading', { name: 'Women’s Network' })).toBeVisible();
    await expect(page.getByText('Whole Church')).toHaveCount(0);
  });

  test('asks the Cell report for their Network, never the whole church', async ({ page }) => {
    await mockSignedIn(page);
    await mockNetworkAdmin(page);
    await mockCellReport(page);
    const asked = await mockCellTwelve(page);

    await page.goto('/reports/cells');

    await expect.poll(() => asked.length).toBeGreaterThan(0);
    expect(asked[0].get('scope')).toBe('NETWORK');
    expect(asked[0].get('network')).toBe('WOMENS');
  });

  test('carries the Conquest item', async ({ page }) => {
    await mockSignedIn(page);
    await mockNetworkAdmin(page);
    await mockNetworkCounts(page);

    await page.goto('/reports/number-of-cells');

    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Conquest' }),
    ).toBeVisible();
  });
});
