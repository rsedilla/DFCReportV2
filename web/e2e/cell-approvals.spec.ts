import { expect, test, type Page } from '@playwright/test';

import { MEMBER_CHOICES, PERSON_IN_SCOPE, mockCellApprover, mockSignedIn } from './mock-api';
import { mockCells } from './mock-attendance';

/**
 * Cells to Approve, the Cells page's third tab (SKILL.md section 10, decisions 0352 and 0353),
 * and section 15's *Fewer than 3 members* on the running Cells. The route decides what the
 * reader may approve; these cases pin what the screen shows and sends.
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

  await page.route('**/api/v1/cells/leadership-requests', (route) =>
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
  test('is a third tab, with its count, for an account that may approve', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellApprover(page);
    await mockQueue(page);

    await page.goto('/cells');

    const tabs = page.getByRole('group', { name: 'Which Cells' });
    await expect(tabs.getByRole('button')).toHaveText([
      'Running Cells',
      'Closed Cells',
      /^Cells to Approve\s*1$/,
    ]);

    await tabs.getByRole('button', { name: /Cells to Approve/ }).click();
    await expect(page).toHaveURL(/view=APPROVE/);

    const card = page.getByRole('listitem').filter({ hasText: 'New Cell led by' });
    await expect(card).toContainText(`New Cell led by ${PERSON_IN_SCOPE.full_name}`);
    await expect(card).toContainText('Couple, Wednesdays');
    await expect(card).toContainText('asked by Corazon Batac');
    await expect(card).toContainText('In Elena Cruz’s branch');
    await expect(card).toContainText('Members: Ana Dela Cruz, Bea Mendoza, Carla Navarro');
  });

  test('approves a request, and the queue is read again', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellApprover(page);
    const posted = await mockQueue(page);

    await page.goto('/cells?view=APPROVE');
    await page.getByRole('button', { name: 'Approve', exact: true }).click();

    await expect(page.getByText('Nothing waiting for you to approve.')).toBeVisible();
    expect(posted).toEqual([
      { path: `/api/v1/cells/leadership-requests/${REQUEST_ID}/approve`, body: {} },
    ]);
  });

  test('declines with one of section 10’s reasons', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellApprover(page);
    const posted = await mockQueue(page);

    await page.goto('/cells?view=APPROVE');
    await page.getByRole('button', { name: 'Decline', exact: true }).click();
    const decline = page.getByRole('button', { name: 'Decline request' });
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

  test('is not offered to an account that may not approve', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);

    await page.goto('/cells');

    await expect(page.getByRole('group', { name: 'Which Cells' }).getByRole('button')).toHaveText([
      'Running Cells',
      'Closed Cells',
    ]);
  });
});

test.describe('Fewer than 3 members (decision 0353)', () => {
  test('narrows the running Cells, and asks the server for them', async ({ page }) => {
    await mockSignedIn(page);
    await mockCells(page);
    const asked: URL[] = [];
    await page.route('**/api/v1/cells?*', (route) => {
      asked.push(new URL(route.request().url()));
      return route.fallback();
    });

    await page.goto('/cells');
    const button = page.getByRole('button', { name: 'Fewer than 3 members' });
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await button.click();

    await expect(page).toHaveURL(/few=1/);
    await expect(page.getByRole('button', { name: 'Showing fewer than 3 members' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect
      .poll(() => asked.some((url) => url.searchParams.get('fewer_than_three') === 'true'))
      .toBe(true);
  });
});
