import { expect, test } from '@playwright/test';

import { PERSON_IN_SCOPE, PERSON_WITHHELD, mockPeople, mockSignedIn } from './mock-api';

/**
 * A list keeps the page shown, faded, while its next page loads (`lib/keep-previous-page.ts`),
 * rather than blanking to "Loading" between pages. A new search is a different list and is not
 * kept. Names are invented (`CLAUDE.md`, Secrets).
 */

function json(body: unknown) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

test('People keeps the page shown, faded, until the next page arrives', async ({ page }) => {
  await mockSignedIn(page);
  await mockPeople(page);

  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/people?*', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    if (cursor === null) {
      return route.fulfill(
        json({ data: [{ ...PERSON_IN_SCOPE, direct_leader_name: 'Teofilo Ramos' }], next_cursor: 'page-two' }),
      );
    }
    await held;
    return route.fulfill(json({ data: [PERSON_WITHHELD], next_cursor: null }));
  });

  await page.goto('/people?q=Ramos');
  const first = page.getByRole('link', { name: PERSON_IN_SCOPE.full_name }).first();
  await expect(first).toBeVisible();

  await page.getByRole('navigation', { name: 'Results' }).getByRole('button', { name: 'Next' }).click();

  // The first page stays, marked busy, and Loading is not shown in its place.
  await expect(first).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(1);
  await expect(page.getByText('Loading…')).toHaveCount(0);

  release();
  await expect(page.getByRole('link', { name: PERSON_WITHHELD.full_name }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: PERSON_IN_SCOPE.full_name })).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
});
