import { expect, test, type Page } from '@playwright/test';

import {
  MEMBER_CHOICES,
  PERSON_IN_SCOPE,
  mockCellAdministrator,
  mockCellApprover,
  mockSignedIn,
  mockTickedApprover,
} from './mock-api';
import { mockCells } from './mock-attendance';

/**
 * Cells to Approve, a tab of the Cells page (SKILL.md section 10, decisions 0352 and 0353),
 * section 15's *Fewer than 3 members* as the administrator's *Under 3 Members* tab, and
 * which tabs each account is offered (decision 0366). The route decides what the reader may
 * approve; these cases pin what the screen shows and sends.
 */

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

const REQUEST_ID = '3f1b7c6e-0000-4000-8000-000000000981';

const PENDING = {
  id: REQUEST_ID,
  kind: 'NEW_CELL',
  state: 'PENDING',
  restart: false,
  requested_at: '2026-06-20T02:00:00Z',
  prospective_leader_id: PERSON_IN_SCOPE.id,
  prospective_leader: {
    person_id: PERSON_IN_SCOPE.id,
    full_name: PERSON_IN_SCOPE.full_name,
    member_id: PERSON_IN_SCOPE.member_id,
  },
  requested_by: '3f1b7c6e-0000-4000-8000-000000000982',
  requested_by_person: {
    person_id: '22222222-3333-4444-8555-666666666666',
    full_name: 'Corazon Batac',
    member_id: 'M-000017',
  },
  cell: { cell_id: null, category: 'COUPLE', day_of_week: 3, time_of_day: '19:30:00' },
  outgoing_leader: null,
  members: MEMBER_CHOICES.map((member) => ({
    person_id: member.id,
    full_name: member.full_name,
    member_id: member.member_id,
  })),
  branch_of: {
    person_id: '22222222-3333-4444-8555-000000000001',
    full_name: 'Elena Cruz',
    member_id: 'M-000003',
  },
};

/** The queue, answering `pending` until a decision empties it. Returns what was posted. */
async function mockQueue(page: Page): Promise<{ path: string; body: unknown }[]> {
  const posted: { path: string; body: unknown }[] = [];
  let pending: unknown[] = [PENDING];

  // Read every page, 200 at a time (decision 0352); one page here.
  await page.route('**/api/v1/cells/leadership-requests?*', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill(json({ data: pending, next_cursor: null }))
      : route.fallback(),
  );
  await page.route('**/api/v1/cells/leadership-requests/*/*', (route) => {
    posted.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });
    pending = [];
    return route.fulfill(json({ id: REQUEST_ID, state: 'APPROVED' }));
  });

  return posted;
}

test.describe('Cells to Approve (decision 0352)', () => {
  test('is the administrator’s last tab, with its count', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellAdministrator(page, { approver: true });
    await mockQueue(page);

    await page.goto('/cells');

    // The administrator's four tabs (decision 0420): the lists that ask for action share one.
    const tabs = page.getByRole('group', { name: 'Which Cells' });
    await expect(tabs.getByRole('button')).toHaveText([
      'Active Cells',
      'Needs Attention',
      'Closed Cells',
      /^Cells to Approve\s*1$/,
    ]);
    // It opens on the first of them, with a switch to the rest.
    await tabs.getByRole('button', { name: 'Needs Attention' }).click();
    await expect(page).toHaveURL(/view=NOCELL/);
    await expect(tabs.getByRole('button', { name: 'Needs Attention' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('group', { name: 'Which list' }).getByRole('button')).toHaveText([
      /^No CG Yet/,
      'Under 3 Members',
      'Inactive 3+ Months',
      /^Time Clashes/,
    ]);

    await tabs.getByRole('button', { name: /Cells to Approve/ }).click();
    await expect(page).toHaveURL(/view=APPROVE/);

    // Plain text, one line each, and the members one per line with their Member IDs (owner,
    // 2026-11-06).
    const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'New Cell' }) });
    const line = (term: string) => card.locator('dt', { hasText: term }).locator('xpath=following-sibling::dd[1]');
    await expect(line('Leader')).toHaveText(`${PERSON_IN_SCOPE.full_name} · ${PERSON_IN_SCOPE.member_id}`);
    await expect(line('Group')).toHaveText('Couple');
    await expect(line('Meets')).toHaveText(/^Wednesdays at 7:30/);
    await expect(line('Asked by')).toHaveText('Corazon Batac, 20 Jun');
    await expect(line('Branch')).toHaveText('Elena Cruz’s');
    await expect(card.getByRole('heading', { name: 'Members (3)' })).toBeVisible();
    await expect(card.getByRole('list').getByRole('listitem')).toHaveText([
      'Ana Dela Cruz · M-000701',
      'Bea Mendoza · M-000702',
      'Carla Navarro · M-000703',
    ]);
  });

  test('approves a request only once Yes is pressed, and the queue is read again', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellApprover(page);
    const posted = await mockQueue(page);

    await page.goto('/cells?view=APPROVE');
    await page.getByRole('button', { name: 'Approve', exact: true }).click();

    // A tap asks first, and sends nothing (owner, 2026-11-06).
    await expect(page.getByText('Create this Cell now?')).toBeFocused();
    await expect(
      page.getByText(`${PERSON_IN_SCOPE.full_name} becomes its leader, with the 3 members above.`),
    ).toBeVisible();
    expect(posted).toEqual([]);

    // Back returns to the request, still sending nothing.
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByText('Create this Cell now?')).toHaveCount(0);
    expect(posted).toEqual([]);

    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, approve' }).click();

    await expect(page.getByText('Nothing waiting for you to approve.')).toBeVisible();
    expect(posted).toEqual([
      { path: `/api/v1/cells/leadership-requests/${REQUEST_ID}/approve`, body: {} },
    ]);
  });

  test('a handover names the leader now and the new one, and asks before handing over', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellApprover(page);
    const handover = {
      ...PENDING,
      kind: 'HANDOVER',
      cell: { cell_id: 'CELL-000009', category: 'YOUNG_PRO', day_of_week: 5, time_of_day: '19:00:00' },
      outgoing_leader: { person_id: '22222222-3333-4444-8555-000000000009', full_name: 'Lorna Cruz', member_id: 'M-000009' },
      members: [],
    };
    await page.route('**/api/v1/cells/leadership-requests?*', (route) =>
      route.fulfill(json({ data: [handover], next_cursor: null })),
    );

    await page.goto('/cells?view=APPROVE');
    const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Hand over CELL-000009' }) });
    const line = (term: string) => card.locator('dt', { hasText: term }).locator('xpath=following-sibling::dd[1]');
    await expect(line('Led now by')).toHaveText('Lorna Cruz · M-000009');
    await expect(line('New leader')).toHaveText(`${PERSON_IN_SCOPE.full_name} · ${PERSON_IN_SCOPE.member_id}`);
    await expect(card.getByRole('heading', { name: /^Members/ })).toHaveCount(0);

    await card.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(card.getByText('Hand this Cell over now?')).toBeVisible();
    await expect(card.getByText(`${PERSON_IN_SCOPE.full_name} becomes its leader in place of Lorna Cruz.`)).toBeVisible();
  });

  test('declines with one of section 10’s reasons', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellApprover(page);
    const posted = await mockQueue(page);

    await page.goto('/cells?view=APPROVE');
    await page.getByRole('button', { name: 'Decline', exact: true }).click();
    const decline = page.getByRole('button', { name: 'Decline' });
    await expect(decline).toBeDisabled();
    await page.getByRole('radio', { name: 'Not the right time yet' }).check();
    await decline.click();

    await expect(page.getByText('Nothing waiting for you to approve.')).toBeVisible();
    expect(posted).toEqual([
      {
        path: `/api/v1/cells/leadership-requests/${REQUEST_ID}/decline`,
        body: { reason: 'TIMING_DEFERRED' },
      },
    ]);
  });

  // A Primary sees Active Cells alone (decision 0366).
  test('is not offered to a Primary who may not approve', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);

    await page.goto('/cells');

    // No CG Yet beside it since decision 0381.
    await expect(page.getByRole('group', { name: 'Which Cells' }).getByRole('button')).toHaveText([
      'Active Cells',
      /^No CG Yet/,
    ]);
    // The total stays with the list it counts (decision 0400).
    await expect(page.getByRole('heading', { name: /^\d+ Cell Groups? in your care$/ })).toBeVisible();
  });

  test('is a Primary’s tab once they are ticked Approves Cells', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockTickedApprover(page);
    await mockQueue(page);

    await page.goto('/cells');

    const tabs = page.getByRole('group', { name: 'Which Cells' });
    await expect(tabs.getByRole('button')).toHaveText([
      'Active Cells',
      /^No CG Yet/,
      /^Cells to Approve\s*1$/,
    ]);
    await tabs.getByRole('button', { name: /Cells to Approve/ }).click();
    await expect(page).toHaveURL(/view=APPROVE/);
    await expect(page.getByRole('heading', { name: 'New Cell' })).toBeVisible();
  });

  test('an address naming an administrator’s list opens a Primary’s Active Cells', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockTickedApprover(page);
    await mockQueue(page);

    for (const view of ['FEW', 'QUIET', 'CLOSED']) {
      await page.goto(`/cells?view=${view}`);
      await expect(page.getByRole('button', { name: 'Active Cells' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByRole('table', { name: 'Cells you oversee' })).toBeVisible();
    }
  });
});

test.describe('Under 3 Members (decisions 0353 and 0366)', () => {
  test('is the administrator’s tab, and asks the server for those Cells', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-06-24T02:00:00Z'));
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellAdministrator(page);
    const asked: URL[] = [];
    await page.route('**/api/v1/cells?*', (route) => {
      asked.push(new URL(route.request().url()));
      return route.fallback();
    });

    await page.goto('/cells');
    // The filters left the bar and became tabs, and then lists under Needs Attention (decision 0420).
    await expect(page.getByRole('button', { name: /fewer than 3 members/i })).toHaveCount(0);
    await page.getByRole('button', { name: 'Needs Attention' }).click();
    const tab = page.getByRole('group', { name: 'Which list' }).getByRole('button', { name: 'Under 3 Members' });
    await expect(tab).toHaveAttribute('aria-pressed', 'false');
    await tab.click();

    await expect(page).toHaveURL(/view=FEW/);
    await expect(tab).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(() => asked.some((url) => url.searchParams.get('fewer_than_three') === 'true'))
      .toBe(true);
    // It keeps its month arrows, its Recorded column being the month's, and no totals.
    await expect(page.getByRole('button', { name: 'Show May 2026' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Cells you oversee/ })).toHaveCount(0);
  });
});

test.describe('Time Clashes (decision 0392)', () => {
  const CLASHES = [
    {
      leader: {
        person_id: PERSON_IN_SCOPE.id,
        member_id: PERSON_IN_SCOPE.member_id,
        full_name: PERSON_IN_SCOPE.full_name,
      },
      minutes_apart: 30,
      cells: [
        {
          cell_uuid: '3f1b7c6e-0000-4000-8000-000000000a01',
          cell_id: 'CELL-000004',
          category: 'YOUNG_PRO',
          day_of_week: 6,
          time_of_day: '19:00',
        },
        {
          cell_uuid: '3f1b7c6e-0000-4000-8000-000000000a02',
          cell_id: 'CELL-000007',
          category: 'YOUTH',
          day_of_week: 6,
          time_of_day: '19:30',
        },
      ],
    },
  ];

  test('lists each leader whose Cells start less than two hours apart, with its count', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellAdministrator(page);
    await page.route('**/api/v1/cells/schedule-clashes', (route) =>
      route.fulfill(json({ data: CLASHES })),
    );

    await page.goto('/cells');
    await page.getByRole('button', { name: 'Needs Attention' }).click();
    const tab = page
      .getByRole('group', { name: 'Which list' })
      .getByRole('button', { name: /^Time Clashes/ });
    await expect(tab).toHaveText(/^Time Clashes\s*1$/);
    await tab.click();

    await expect(page).toHaveURL(/view=CLASH/);
    const clash = page.getByRole('listitem').filter({ hasText: '30 minutes apart' }).first();
    await expect(clash).toContainText(`${PERSON_IN_SCOPE.full_name} · 30 minutes apart`);
    await expect(clash).toContainText('Young Pro · Sat CELL-000004');
    await expect(clash).toContainText('Saturday, 19:00');
    await expect(clash).toContainText('Youth · Sat CELL-000007');
    await expect(clash).toContainText('Saturday, 19:30');
    // The list's own page, so none of Active Cells' controls.
    await expect(page.getByRole('button', { name: /^Cells you oversee/ })).toHaveCount(0);
  });

  test('says so when there is none', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellAdministrator(page);
    await page.route('**/api/v1/cells/schedule-clashes', (route) =>
      route.fulfill(json({ data: [] })),
    );

    await page.goto('/cells?view=CLASH');

    await expect(
      page.getByText('No leader’s Cell Groups start less than 2 hours apart.'),
    ).toBeVisible();
  });

  test('is not offered to a Primary, even by its address', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    let asked = false;
    await page.route('**/api/v1/cells/schedule-clashes', (route) => {
      asked = true;
      return route.fulfill(json({ data: CLASHES }));
    });

    await page.goto('/cells?view=CLASH');

    await expect(page.getByRole('button', { name: 'Active Cells' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: /^Time Clashes/ })).toHaveCount(0);
    expect(asked).toBe(false);
  });
});

test.describe('the Cells tabs on a phone (decisions 0366 and 0420)', () => {
  for (const width of [320, 390]) {
    test(`wrap at ${width}px, with every tab inside the screen and no sideways scroll`, async ({
      page,
    }) => {
      await mockSignedIn(page);
      await mockCells(page);
      await mockCellAdministrator(page, { approver: true });
      await mockQueue(page);
      await page.setViewportSize({ width, height: 800 });

      await page.goto('/cells');
      const tabs = page.getByRole('group', { name: 'Which Cells' }).getByRole('button');
      await expect(tabs).toHaveCount(4);

      const tops = new Set<number>();
      for (const tab of await tabs.all()) {
        const box = await tab.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        tops.add(Math.round(box!.y));
      }
      expect(tops.size).toBeGreaterThan(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }
});

test.describe('fewer tabs (decision 0420)', () => {
  test('a Full view leader ticked Approves Cells keeps No CG Yet as its own tab', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockTickedApprover(page);
    await mockQueue(page);

    await page.goto('/cells');
    const tabs = page.getByRole('group', { name: 'Which Cells' });
    await expect(tabs.getByRole('button')).toHaveText(['Active Cells', /^No CG Yet/, /^Cells to Approve/]);
    await expect(tabs.getByRole('button', { name: 'Needs Attention' })).toHaveCount(0);
  });

  test('on a phone an odd last tab fills its row', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockSignedIn(page);
    await mockCells(page);
    await mockTickedApprover(page);
    await mockQueue(page);

    await page.goto('/cells');
    const tabs = page.getByRole('group', { name: 'Which Cells' });
    const buttons = tabs.getByRole('button');
    await expect(buttons).toHaveCount(3);
    const row = await tabs.boundingBox();
    const first = await buttons.nth(0).boundingBox();
    const last = await buttons.nth(2).boundingBox();
    // Two to a row, the third alone filling the second row.
    expect(Math.abs(last!.width - row!.width)).toBeLessThanOrEqual(2);
    expect(first!.width).toBeLessThan(row!.width / 2 + 2);
  });
});
