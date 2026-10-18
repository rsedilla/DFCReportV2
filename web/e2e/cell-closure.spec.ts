import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn } from './mock-api';

/**
 * Closing a Cell and the *No meeting in 3 months* list (SKILL.md sections 10 and 15,
 * decision 0355), the administrator's *Inactive (3+ Months) Cells* tab (decision 0366): only
 * an account that may close is offered the tab and *Close this Cell*, the tab carries no
 * count, and every closure sends a reason, an explanation and a decision about each member.
 * Invented people throughout.
 */

const QUIET_CELL = {
  id: '6b1c2d3e-0000-4000-8000-000000000901',
  cell_id: 'CELL-000901',
  state: 'ACTIVE',
  category: 'YOUTH',
  member_count: 2,
  network: 'MENS',
  schedule: { day_of_week: 2, time_of_day: '19:00' },
  leader: {
    person_id: '6b1c2d3e-0000-4000-8000-000000000911',
    member_id: 'M-009911',
    full_name: 'Dario Velasco',
  },
  coverage: { recorded: 0, scheduled: 4, behind: 0 },
  no_meeting: [
    { month: '2026-07-01', did_not_meet: 2, not_recorded: 2 },
    { month: '2026-08-01', did_not_meet: 0, not_recorded: 4 },
    { month: '2026-09-01', did_not_meet: 0, not_recorded: 5 },
  ],
};

const CLOSED_CELL = {
  ...QUIET_CELL,
  id: '6b1c2d3e-0000-4000-8000-000000000902',
  cell_id: 'CELL-000902',
  state: 'CLOSED',
  member_count: 0,
  closed_on: '2026-10-10',
  closure_reason: 'LEADER_MOVED_AWAY',
  closure_explanation: 'Dario moved to Davao for work; two members joined another Cell.',
  restarted_as: null,
  may_restart: false,
};

const MEMBERS = [
  {
    person_id: '6b1c2d3e-0000-4000-8000-000000000921',
    member_id: 'M-009921',
    full_name: 'Elisa Moreno',
    started_at: '2026-01-10T00:00:00Z',
  },
  {
    person_id: '6b1c2d3e-0000-4000-8000-000000000922',
    member_id: 'M-009922',
    full_name: 'Fidel Ramos',
    started_at: '2026-02-14T00:00:00Z',
  },
];

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

/** The Cells routes, keeping every list URL asked and every closure body sent. */
async function mockCellRoutes(page: Page, { mayClose }: { mayClose: boolean }) {
  const asked: URL[] = [];
  const closures: unknown[] = [];

  await page.route('**/api/v1/cells/counts', (route) =>
    route.fulfill(json({ in_scope: 4, led_by_me: 0 })),
  );
  await page.route('**/api/v1/cells?*', (route) => {
    const url = new URL(route.request().url());
    asked.push(url);
    if (url.searchParams.get('state') === 'CLOSED') {
      return route.fulfill(
        json({ reporting_month: '2026-10-01', open: true, data: [CLOSED_CELL], next_cursor: null }),
      );
    }
    if (url.searchParams.get('no_meeting') === 'true') {
      return route.fulfill(
        json({
          reporting_month: '2026-10-01',
          open: true,
          no_meeting_months: ['2026-07-01', '2026-08-01', '2026-09-01'],
          data: [{ ...QUIET_CELL, may_close: mayClose }],
          next_cursor: null,
        }),
      );
    }
    const { no_meeting: _unused, ...running } = QUIET_CELL;
    void _unused;
    return route.fulfill(
      json({
        reporting_month: '2026-10-01',
        open: true,
        data: [{ ...running, may_close: mayClose }],
        next_cursor: null,
      }),
    );
  });
  await page.route('**/api/v1/cells/*/members*', (route) =>
    route.fulfill(json({ data: MEMBERS, next_cursor: null })),
  );
  await page.route('**/api/v1/cells/*/closure', (route) => {
    closures.push(route.request().postDataJSON());
    return route.fulfill(json({ id: QUIET_CELL.id, state: 'CLOSED' }));
  });

  return { asked, closures };
}

/** The account as an administrator, holding `cell.manage_lifecycle` at Whole Church. */
async function mockCloser(page: Page) {
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
          {
            capability: 'cell.manage_lifecycle',
            scope_type: 'WHOLE_CHURCH',
            scope_network: null,
            read_only: false,
            source: 'ROLE',
          },
        ],
      }),
    ),
  );
}

test.describe('No meeting in 3 months (decision 0355)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-16T02:00:00Z'));
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  // The Inactive list is the administrator's (decision 0366): a Primary is offered Active
  // Cells alone, and an address naming the list opens Active Cells.
  test('a Primary is offered no Inactive tab, and its address opens Active Cells', async ({
    page,
  }) => {
    await mockSignedIn(page);
    const { asked } = await mockCellRoutes(page, { mayClose: false });
    await page.goto('/cells?view=QUIET');

    const tabs = page.getByRole('group', { name: 'Which Cells' }).getByRole('button');
    await expect(tabs).toHaveText(['Active Cells']);
    await expect(page.getByRole('table', { name: 'Cells you oversee' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Cells with no meeting held' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /No meeting in/ })).toHaveCount(0);
    await expect
      .poll(() => asked.some((url) => url.searchParams.get('no_meeting') === null))
      .toBe(true);
  });

  test('the administrator sees each month in words, with no count on the tab', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCloser(page);
    const { asked } = await mockCellRoutes(page, { mayClose: true });
    await page.goto('/cells');

    const tab = page.getByRole('button', { name: 'Inactive (3+ Months) Cells', exact: true });
    await expect(tab).toHaveText('Inactive (3+ Months) Cells');
    await tab.click();
    await expect(page).toHaveURL(/view=QUIET/);
    await expect(tab).toHaveAttribute('aria-pressed', 'true');

    const table = page.getByRole('table', { name: 'Cells with no meeting held' });
    await expect(table).toBeVisible();
    expect(asked.some((url) => url.searchParams.get('no_meeting') === 'true')).toBe(true);
    // Its window is its own, so there are no month arrows, and the totals stay on Active Cells.
    await expect(page.getByRole('button', { name: /^Show .* 2026$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Cells you lead/ })).toHaveCount(0);
    await expect(table.getByRole('columnheader')).toHaveText([
      'Cell',
      'Leader',
      'Members',
      'Jul 2026',
      'Aug 2026',
      'Sep 2026',
      'Close',
    ]);
    const row = table.getByRole('row', { name: /Youth · Tue/ });
    await expect(row).toContainText('Did not meet 2 · Not recorded 2');
    await expect(row).toContainText('Not recorded 5');
    await expect(
      page.getByRole('button', { name: 'Close this Cell, Youth · Tue, led by Dario Velasco' }),
    ).toBeVisible();
  });

  test('an administrator closes a Cell with a reason, an explanation and every member', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCloser(page);
    const { closures } = await mockCellRoutes(page, { mayClose: true });
    await page.goto('/cells?view=QUIET');

    await page
      .getByRole('button', { name: 'Close this Cell, Youth · Tue, led by Dario Velasco' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Close Youth · Tue' });
    await expect(dialog.getByText(/Elisa Moreno, Fidel Ramos\./)).toBeVisible();
    // The retired reason is never offered (decision 0355).
    await expect(dialog.getByRole('radio', { name: 'Members dispersed' })).toHaveCount(0);

    const submit = dialog.getByRole('button', { name: 'Close this Cell' });
    await expect(submit).toBeDisabled();
    await dialog.getByRole('radio', { name: 'Leader moved away' }).check();
    await expect(submit).toBeDisabled();
    await dialog
      .getByLabel('Explanation for the Senior Pastors (required)')
      .fill('Dario moved to Davao for work.');
    // The members decision is made by explicit choice, never by default (section 10).
    await expect(submit).toBeDisabled();
    await dialog.getByRole('radio', { name: 'Leave them without a Cell' }).check();
    await submit.click();

    await expect(dialog).toBeHidden();
    expect(closures).toEqual([
      {
        reason: 'LEADER_MOVED_AWAY',
        note: 'Dario moved to Davao for work.',
        members: MEMBERS.map((member) => ({
          person_id: member.person_id,
          destination_cell_id: null,
        })),
      },
    ]);
  });

  test('the closed view shows the explanation a closure carries', async ({ page }) => {
    await mockSignedIn(page);
    await mockCloser(page);
    await mockCellRoutes(page, { mayClose: false });
    await page.goto('/cells?view=CLOSED');

    const table = page.getByRole('table', { name: 'Closed Cells you oversee' });
    const row = table.getByRole('row', { name: /Leader moved away/ });
    await expect(row).toContainText(
      'Dario moved to Davao for work; two members joined another Cell.',
    );
  });
});
