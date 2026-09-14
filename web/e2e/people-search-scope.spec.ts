import { expect, test } from '@playwright/test';

import { mockPeople, mockSignedIn } from './mock-api';

/**
 * Which search each surface asks for (SKILL.md section 8, decision 0244).
 *
 * The People screen shows the people a leader pastors. The three person pickers —
 * Add a Person, Add a member to a Cell, and naming a new pastoral leader on a
 * reassignment — keep the church-wide directory, because each names one specific
 * person for one operation rather than offering a place to look around.
 *
 * **This asserts the request rather than the rendered rows, and that is the point.**
 * The narrowing is enforced by the API: the rows a leader may see are decided there,
 * against their capability's scope, and a browser test against a mocked response
 * would assert only what the mock returned. What the client owes is sending the
 * right question, and that is invisible in a passing screen — both surfaces render
 * identically whichever flag they send, because the mock answers the same either
 * way. It is exactly the shape `session.spec.ts` exists for one domain over.
 *
 * The API-layer cases in `api/test/api/people.e2e.spec.ts` cover the other half:
 * that the flag narrows rows, never widens fields, and spends a page limit on rows
 * it returns.
 */

/** Every `/api/v1/people?…` request the page made, in order. */
async function recordSearches(page: import('@playwright/test').Page): Promise<string[]> {
  const urls: string[] = [];

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/v1/people?')) {
      urls.push(url);
    }
  });

  return urls;
}

test.describe('which search each surface asks for', () => {
  test('the People screen asks for its own scope', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    const searches = await recordSearches(page);

    await page.goto('/people');
    await page.getByLabel('Search by name').fill('Bautista');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect
      .poll(() => searches.length, { message: 'the screen never searched' })
      .toBeGreaterThan(0);

    for (const url of searches) {
      expect(url, 'the People screen asked for the whole church').not.toContain('church_wide');
    }
  });

  test('adding a person searches the whole church, so a duplicate is found', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    const searches = await recordSearches(page);

    await page.goto('/people/new');
    // The picker on this screen chooses the new person's pastoral leader. Its own
    // label and button differ from the People screen's, which is why they are named
    // rather than reused.
    await page.getByLabel('Search for a leader by name').fill('Bautista');
    await page.getByRole('button', { name: 'Find' }).click();

    await expect
      .poll(() => searches.length, { message: 'the picker never searched' })
      .toBeGreaterThan(0);

    expect(
      searches.some((url) => url.includes('church_wide=true')),
      'the picker narrowed itself to the actor scope, which would make a person in another branch unreachable',
    ).toBe(true);
  });
});

test.describe('what the People screen says when it finds nobody', () => {
  test('does not claim it searched the whole church', async ({ page }) => {
    await mockSignedIn(page);
    await page.route('**/api/v1/people?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], next_cursor: null }),
      }),
    );

    await page.goto('/people');
    await page.getByLabel('Search by name').fill('Nobodyhere');
    await page.getByRole('button', { name: 'Search' }).click();

    const main = page.locator('main');
    await expect(main).toContainText('Nobody you oversee matches');

    // **The sentence this replaced.** It read "This searched the whole church, not
    // only the people you pastor. If they are new, add them." — false after decision
    // 0244, and an instruction to create the duplicate on the one screen the ruling
    // narrows. It survived 402 browser tests because none of them read this copy.
    await expect(main).not.toContainText('searched the whole church');
  });
});
