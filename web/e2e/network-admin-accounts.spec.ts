import { expect, test, type Page } from '@playwright/test';

import { mockAdminArea, mockPeople, mockSignedIn, PERSON_IN_SCOPE } from './mock-api';
import { mockPastoralPath } from './mock-attendance';

/**
 * The Network Admin's Admin area and account powers (SKILL.md sections 7 and 19, decision
 * 0469): Home and Accounts for their own Network, Leader accounts only, Full view only. Every
 * name and figure is invented.
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

/** A Network Admin's session: reads and the two account capabilities, across the Women's Network. */
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
          'dcc.view_subtree',
          'cell.view_subtree',
          'reports.view_subtree',
          'conquest.view_subtree',
          'suynl.view_subtree',
          'training.view_subtree',
          'accounts.manage',
          'roles.manage',
        ].map(held),
      }),
    ),
  );
}

async function openAdmin(page: Page, path = '/admin'): Promise<void> {
  await mockSignedIn(page);
  await mockNetworkAdmin(page);
  await mockAdminArea(page);
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible();
}

test.describe('a Network Admin’s Admin item', () => {
  test('is where the account lands', async ({ page }) => {
    await mockSignedIn(page);
    await mockNetworkAdmin(page);
    await mockAdminArea(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('has Home and Accounts, and no Settings or Audit Log', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAdmin(page);

    const tabs = page.getByRole('group', { name: 'Admin' });
    await expect(tabs.getByRole('button')).toHaveText(['Home', 'Accounts']);
    await expect(page.getByText('Running DREAMS for the Women’s Network.')).toBeVisible();
  });

  test('opens Home when asked for Settings or the Audit Log by address', async ({ page }) => {
    const asked: string[] = [];
    await page.route('**/api/v1/settings', (route) => {
      asked.push(route.request().url());
      return route.fulfill(json({ error: { code: 'SCOPE_DENIED', message: 'No.', details: {} } }, 403));
    });
    await page.route('**/api/v1/audit-log*', (route) => {
      asked.push(route.request().url());
      return route.fulfill(json({ error: { code: 'SCOPE_DENIED', message: 'No.', details: {} } }, 403));
    });

    for (const tab of ['settings', 'audit']) {
      await openAdmin(page, `/admin?tab=${tab}`);
      await expect(page.getByRole('heading', { name: 'Needs you now' })).toBeVisible();
    }
    expect(asked).toEqual([]);
  });
});

test.describe('a Network Admin’s Home', () => {
  test('is for their Network, with nothing they cannot act on', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const approvals: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/v1/cells/leadership-requests') {
        approvals.push(request.url());
      }
    });
    await openAdmin(page);

    await expect(
      page.getByText('Women’s Network, as of now. Each one opens its list.'),
    ).toBeVisible();
    await expect(page.getByText('Women’s Network, weeks still open.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The Women’s Network' })).toBeVisible();

    // What they hold: the lists they read and the accounts they manage.
    await expect(page.getByRole('heading', { name: 'No Leader Yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'See who' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Accounts not activated' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'CG Records Due' })).toBeVisible();

    // What they do not: approving, assigning, adding, creating a Cell, settings.
    await expect(page.getByRole('heading', { name: 'Cells to approve' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Assign leaders' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Add a person' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'New Cell' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Time Clashes' })).toHaveCount(0);
    await expect(page.getByText('DCC calendar')).toHaveCount(0);
    expect(approvals).toEqual([]);
  });
});

test.describe('a Network Admin’s Accounts', () => {
  test('offers no Network Admin form and no second-step filter', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAdmin(page, '/admin?tab=accounts');

    await expect(page.getByRole('button', { name: /^Waiting for activation/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add a Network Admin' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Second step not set up/ })).toHaveCount(0);
  });
});

test.describe('a Network Admin on a person’s Account view', () => {
  const PROFILE = `/people/${PERSON_IN_SCOPE.id}?view=account`;
  const ACCOUNT_ID = '3f1b7c6e-0000-4000-8000-000000000901';

  async function open(page: Page, account: Record<string, unknown> | 'REFUSED' | null) {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockNetworkAdmin(page);
    await mockPastoralPath(page);
    await page.route(`**/api/v1/accounts/for-person/${PERSON_IN_SCOPE.id}`, (route) =>
      account === 'REFUSED'
        ? route.fulfill(
            json(
              {
                error: {
                  code: 'SCOPE_DENIED',
                  message: 'That account is not a Leader account of your Network.',
                  details: {},
                },
              },
              403,
            ),
          )
        : route.fulfill(json({ account })),
    );
    await page.goto(PROFILE);
  }

  const leaderAccount = (ticks: Record<string, boolean>) => ({
    id: ACCOUNT_ID,
    email: 'marilou@example.test',
    username: null,
    status: 'ACTIVE',
    roles: ['LEADER'],
    created_at: '2026-09-22T02:00:00.000Z',
    second_step: { required: false, set_up_at: null },
    full_view: true,
    approves_cells: false,
    moves_people: false,
    ...ticks,
  });

  test('ticks Full view and is offered neither other tick', async ({ page }) => {
    await open(page, leaderAccount({}));

    await expect(page.getByRole('checkbox', { name: /^Full view/ })).toBeEnabled();
    await expect(page.getByRole('checkbox', { name: /^Approves Cells/ })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /^Moves people/ })).toHaveCount(0);
  });

  test('cannot clear Full view while a tick only the Admin gives is on', async ({ page }) => {
    await open(page, leaderAccount({ moves_people: true }));

    await expect(page.getByRole('checkbox', { name: /^Full view/ })).toBeDisabled();
    await expect(
      page.getByText('Only the Admin clears this while Moves people is on.'),
    ).toBeVisible();
    await expect(page.getByText('Moves people is on. Only the Admin changes this.')).toBeVisible();
  });

  test('gives a Leader account without asking for a role', async ({ page }) => {
    await open(page, null);
    const sent: Record<string, unknown>[] = [];
    await page.route(
      (url) => url.pathname === '/api/v1/accounts',
      async (route) => {
        sent.push(route.request().postDataJSON() as Record<string, unknown>);
        await route.fulfill(json({ id: ACCOUNT_ID }, 201));
      },
    );

    await page.getByRole('button', { name: 'Give Marilou an account' }).click();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await page.getByLabel('Email address').fill('marilou@example.test');
    await page.getByRole('button', { name: 'Create Account' }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ role: 'LEADER', email: 'marilou@example.test' });
  });

  test('says an account outside their reach is the Admin’s, with no error', async ({ page }) => {
    await open(page, 'REFUSED');

    await expect(page.getByText('Marilou’s account is managed by the Admin.')).toBeVisible();
    await expect(page.getByText('That account is not a Leader account')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Give Marilou an account/ })).toHaveCount(0);
  });
});
