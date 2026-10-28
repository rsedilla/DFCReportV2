import { expect, test } from '@playwright/test';

import { PERSON_IN_SCOPE, mockPeople, mockSignedIn } from './mock-api';
import { mockCells } from './mock-attendance';

/**
 * How wide a page is, and what its heading carries (decision 0402).
 *
 * A list or a table widens to 1280px beside the sidebar, one person's page stays at
 * 1024px, and a form at 768px; all three start at the same place beside the sidebar,
 * so moving between them moves only the right-hand edge. A heading carries no line
 * that only repeats its title, tabs or headline.
 */
test.describe('page widths (decision 0402)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 864 });
    await mockSignedIn(page);
    await mockPeople(page);
  });

  const main = (page: import('@playwright/test').Page) => page.locator('main#main').first();

  test('a list is up to 1280px wide, beside the sidebar', async ({ page }) => {
    await mockCells(page);
    await page.goto('/cells');
    await expect(page.getByRole('heading', { name: 'Cells', exact: true })).toBeVisible();

    await expect(main(page)).toHaveCSS('max-width', '1280px');
    await expect(main(page)).toHaveCSS('margin-left', '0px');
  });

  test("one person's page stays 1024px wide", async ({ page }) => {
    await page.goto(`/people/${PERSON_IN_SCOPE.id}`);
    await expect(page.getByRole('heading', { name: PERSON_IN_SCOPE.full_name })).toBeVisible();

    await expect(main(page)).toHaveCSS('max-width', '1024px');
  });

  test('a form stays 768px wide', async ({ page }) => {
    await page.goto('/people/new');
    await expect(page.getByRole('heading', { name: 'Add a person' })).toBeVisible();

    await expect(main(page)).toHaveCSS('max-width', '768px');
  });
});

test.describe('a heading carries no line that repeats the page (decision 0402)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
  });

  test('on Cells', async ({ page }) => {
    await mockCells(page);
    await page.goto('/cells');
    const heading = page.getByRole('heading', { name: 'Cells', exact: true });
    await expect(heading).toBeVisible();

    await expect(heading.locator('xpath=following-sibling::p')).toHaveCount(0);
  });

  test('on People', async ({ page }) => {
    await page.goto('/people');
    const heading = page.getByRole('heading', { name: 'People', exact: true });
    await expect(heading).toBeVisible();

    await expect(heading.locator('xpath=following-sibling::p')).toHaveCount(0);
    await expect(page.getByText('Find someone by name or Member ID.')).toHaveCount(0);
  });
});
