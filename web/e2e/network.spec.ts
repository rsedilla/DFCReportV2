import { expect, test } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import { mockNetworkReader, mockNetworkTree, mockPastoralPathAtRoot } from './mock-attendance';

async function signedInReader(page: import('@playwright/test').Page) {
  await mockSignedIn(page);
  await mockPastoralPathAtRoot(page);
  await mockNetworkTree(page);
  await mockNetworkReader(page);
}

/**
 * Where the Network screen starts (decision 0268). `accessibility.spec.ts` scans the branch
 * view; this pins what a reader outside the pastoral tree is shown instead. Invented names.
 */
test.describe('the Network screen’s starting point', () => {
  const root = (id: string, member: string, name: string, direct: number, beneath: number) => ({
    id,
    member_id: member,
    full_name: name,
    leads_anyone: direct > 0,
    direct_reports: direct,
    beneath,
  });

  test('a reader outside the tree starts at the roots, each opening its branch', async ({
    page,
  }) => {
    await signedInReader(page);

    const andres = root('3f1b7c6e-0000-4000-8000-000000000791', 'M-000002', 'Andres Villareal', 12, 40);
    const lorna = root('3f1b7c6e-0000-4000-8000-000000000792', 'M-000003', 'Lorna Villareal', 9, 30);

    // Registered after the default, so it is the one matched.
    await page.route('**/api/v1/network/my-tree*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          person: root('3f1b7c6e-0000-4000-8000-000000000790', 'M-000001', 'Carmela Ocampo', 0, 0),
          data: [],
          next_cursor: null,
          roots: [andres, lorna],
        }),
      }),
    );

    await page.goto('/network');

    await expect(page.getByRole('heading', { name: 'Network roots' })).toBeVisible();
    await expect(
      page.getByText('Figures for September 2026, a month still open.', { exact: false }).last(),
    ).toBeVisible();
    await expect(page.getByText('Nobody reports to you today.')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open Andres Villareal' })).toHaveAttribute(
      'href',
      `/network?focus=${andres.id}`,
    );
    await expect(page.getByRole('link', { name: 'Open Lorna Villareal' })).toBeVisible();
    // A root is never moved (section 5).
    await expect(page.getByRole('button', { name: /^Move/ })).toHaveCount(0);
  });

  test('a reader in the tree starts on their own branch, as before', async ({ page }) => {
    await signedInReader(page);
    await page.goto('/network');

    await expect(page.getByRole('heading', { name: 'Reports to you' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Network roots' })).toHaveCount(0);
  });
});
