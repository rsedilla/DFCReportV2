import { expect, test } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import { mockEquipping, mockRegistrar } from './mock-equipping';

/**
 * The Registration list (decision 0518): a number and the name, the leader of the Cell each
 * person attends, and short labels for the birthday and the status. The requirements not met
 * and the reason stay on the registration and are not on the list. Every name is invented.
 */

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

function row(n: number, last: string, cellLeader: string | null, leads: boolean) {
  const id = n.toString().padStart(2, '0');
  return {
    id: `3f1b7c6e-0000-4000-8000-0000000be1${id}`,
    person: {
      id: `3f1b7c6e-0000-4000-8000-0000000be2${id}`,
      member_id: `M-0009${id}`,
      full_name: `Ana ${last}`,
      list_name: `${last}, Ana`,
    },
    leader_name: 'Benito Cruz',
    cell_leader_name: cellLeader,
    leads_a_cell: leads,
    birthday_recorded: n % 2 === 0,
    status: 'REGISTERED',
    unmet: [],
    exception_reason: null,
    note: null,
    class: null,
    enrollment_id: null,
    registered_at: '2026-11-10T02:00:00.000Z',
    cancel_reason: null,
  };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockRegistrar(page);
  await mockEquipping(page);
});

test('numbers each name, shows the Cell Leader, and leaves the reason off the list', async ({ page }) => {
  await page.goto('/equipping/registration');
  const table = page.getByRole('table', { name: /Registered for Life Class/ });
  await expect(table.getByRole('columnheader', { name: 'Cell Leader' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Leader', exact: true })).toHaveCount(0);

  const carlito = table.getByRole('row', { name: /Manalo, Carlito/ });
  await expect(carlito).toContainText('1.');
  // The leader of the Cell he attends, not his leader in the tree (Benito Cruz).
  await expect(carlito).toContainText('Lorna Reyes');
  await expect(carlito).not.toContainText('Benito Cruz');
  await expect(carlito).toContainText('! Missing');
  await expect(carlito).toContainText('With exception');
  await expect(carlito).not.toContainText('Not met');
  await expect(carlito).not.toContainText('His leader confirms he attends every Sunday.');

  const danica = table.getByRole('row', { name: /Flores, Danica/ });
  await expect(danica).toContainText('2.');
  // She leads a Cell and attends none as a member.
  await expect(danica).toContainText('Leads a Cell');
  await expect(danica).toContainText('✓ Recorded');
  await expect(danica).toContainText('✓ Enrolled');
});

test('says No Cell yet, and the numbers run on after Show more', async ({ page }) => {
  await page.route('**/api/v1/equipping/registrations?*', (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    return route.fulfill(
      json(
        cursor === null
          ? { data: [row(1, 'Abad', 'Lorna Reyes', false), row(2, 'Bayani', null, false)], next_cursor: 'next' }
          : { data: [row(3, 'Cruz', 'Mila Tan', false)], next_cursor: null },
      ),
    );
  });
  await page.goto('/equipping/registration');
  const table = page.getByRole('table', { name: /Registered for Life Class/ });
  await expect(table.getByRole('row', { name: /Bayani, Ana/ })).toContainText('No Cell yet');
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect(table.getByRole('row', { name: /Cruz, Ana/ })).toContainText('3.');
});
