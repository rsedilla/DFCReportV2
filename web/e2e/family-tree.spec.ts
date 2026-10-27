import { expect, test, type Page } from '@playwright/test';

import { mockPeople, mockScreens, mockSignedIn } from './mock-api';
import { mockNetworkTree } from './mock-attendance';

/**
 * The Family Tree tab (SKILL.md section 17, decision 0341): Full view screens alone, the
 * reader's branch as an outline that opens a generation at a time. Names are invented
 * (`CLAUDE.md`, Secrets).
 */

/** Every API path the page asked for, with its query, in order. */
function trackApi(page: Page): string[] {
  const asked: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/')) {
      asked.push(`${request.method()} ${url.pathname}${url.search}`);
    }
  });
  return asked;
}

function peopleTabs(page: Page) {
  return page.getByRole('navigation', { name: 'People' });
}

test('a Full view account has the Family Tree tab, after People', async ({ page }) => {
  await mockSignedIn(page);
  await mockPeople(page);

  await page.goto('/people');

  await expect(peopleTabs(page).getByRole('link')).toHaveText(['Add People', /^Awaiting Leader Assignment/, 'Family Tree']);
  await expect(peopleTabs(page).getByRole('link', { name: 'Family Tree' })).toHaveAttribute(
    'href',
    '/family-tree',
  );
});

test('a Senior Pastor has no Family Tree tab', async ({ page }) => {
  await mockSignedIn(page);
  await mockScreens(page, 'SENIOR_PASTOR');
  await mockPeople(page);

  // A Senior Pastor has no People item (decision 0326), so neither page is offered (decision 0379).
  for (const address of ['/people', '/family-tree']) {
    await page.goto(address);
    await expect(page.getByRole('heading', { name: 'This page isn’t part of your screens' })).toBeVisible();
    await expect(peopleTabs(page)).toHaveCount(0);
  }
});

test('a Recording-only account has no Family Tree tab', async ({ page }) => {
  await mockSignedIn(page);
  await mockScreens(page, 'RECORDING');
  await mockPeople(page);

  await page.goto('/people');

  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Cells' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Family Tree' })).toHaveCount(0);
});

test('opens on the reader with their disciples, and a generation is read when it is opened', async ({
  page,
}) => {
  await mockSignedIn(page);
  await mockNetworkTree(page);
  const asked = trackApi(page);

  await page.goto('/family-tree');

  const tree = page.getByRole('region', { name: 'Family Tree' });
  await expect(tree.getByRole('link', { name: 'Marilou Reyes Santos (you)' })).toBeVisible();
  await expect(tree.getByText('3 direct · 9 beneath')).toBeVisible();
  await expect(
    tree.getByRole('button', { name: 'Hide Marilou Reyes Santos’s disciples' }),
  ).toHaveAttribute('aria-expanded', 'true');

  // Everyone by name, a person who leads nobody included, with no control to open.
  await expect(tree.getByRole('link', { name: 'Efren Dimaculangan' })).toHaveAttribute(
    'href',
    '/people/3f1b7c6e-0000-4000-8000-000000000702',
  );
  await expect(tree.getByText('leads nobody yet').first()).toBeVisible();
  await expect(tree.getByRole('button', { name: /Efren Dimaculangan/ })).toHaveCount(0);

  // Nothing beneath a closed line is asked for.
  expect(asked.filter((request) => request.includes('/children'))).toEqual([]);

  await tree.getByRole('button', { name: 'Show Consuelo Bautista’s disciples' }).click();

  await expect(tree.getByRole('link', { name: 'Teresita Alcantara' })).toBeVisible();
  expect(asked.filter((request) => request.includes('/children'))).toEqual([
    'GET /api/v1/leaders/3f1b7c6e-0000-4000-8000-000000000701/children?limit=200',
  ]);
  await expect(
    tree.getByRole('button', { name: 'Hide Consuelo Bautista’s disciples' }),
  ).toHaveAttribute('aria-expanded', 'true');

  // A generation longer than one read offers the rest.
  await tree.getByRole('button', { name: 'Show more' }).click();
  await expect(tree.getByRole('link', { name: 'Lourdes Magsaysay' })).toBeVisible();
  await expect(tree.getByRole('button', { name: 'Show more' })).toHaveCount(0);
});

test('a reader outside the pastoral tree starts at the Network roots', async ({ page }) => {
  await mockSignedIn(page);
  await mockNetworkTree(page);

  const root = (id: string, name: string) => ({
    id,
    member_id: 'M-000700',
    full_name: name,
    leads_anyone: true,
    direct_reports: 12,
    beneath: 40,
  });

  // Registered after the default, so it is the one matched.
  await page.route('**/api/v1/network/my-tree*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        person: {
          id: '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9',
          member_id: 'M-000001',
          full_name: 'Demo Administrator',
          leads_anyone: false,
          direct_reports: 0,
          beneath: 0,
        },
        data: [],
        next_cursor: null,
        roots: [
          root('3f1b7c6e-0000-4000-8000-000000000901', 'Rogelio Panganiban'),
          root('3f1b7c6e-0000-4000-8000-000000000902', 'Natividad Panganiban'),
        ],
      }),
    }),
  );

  await page.goto('/family-tree');

  const tree = page.getByRole('region', { name: 'Family Tree' });
  await expect(tree.getByRole('link', { name: 'Rogelio Panganiban' })).toBeVisible();
  await expect(tree.getByRole('link', { name: 'Natividad Panganiban' })).toBeVisible();
  await expect(tree.getByText('(you)')).toHaveCount(0);
  await expect(
    tree.getByRole('button', { name: 'Show Rogelio Panganiban’s disciples' }),
  ).toHaveAttribute('aria-expanded', 'false');
});
