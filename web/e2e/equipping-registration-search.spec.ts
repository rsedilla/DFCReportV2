import { expect, test } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import { mockEquipping, mockRegistrar, mockRegistrationSearch } from './mock-equipping';

/**
 * The Register dialog's search results (owner, 2026-11-20, option B): a line saying how many
 * were found and that choosing is the next step, and a *Choose* button on each person, so
 * nobody waits for an OK that does not exist.
 */
test.beforeEach(async ({ page }) => {
  await mockSignedIn(page);
  await mockRegistrar(page);
  await mockEquipping(page);
  await mockRegistrationSearch(page);
});

for (const width of [320, 1280]) {
  test(`at ${width}px each person found has a Choose button, and choosing shows them with Change`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/equipping/registration');
    await page.getByRole('button', { name: 'Register for Life Class' }).click();
    const dialog = page.getByRole('dialog', { name: 'Register for Life Class' });
    await dialog.getByLabel('Person').fill('wil');
    await dialog.getByRole('button', { name: 'Search' }).click();

    await expect(dialog.getByRole('status').filter({ hasText: 'found' })).toHaveText(
      '2 people found. Choose the person to register.',
    );
    const choose = dialog.getByRole('button', { name: 'Choose Wilfredo Sanchez' });
    await expect(choose).toBeVisible();
    await expect(dialog.getByText('Leader: Marites D. Ramos')).toBeVisible();
    // 2.5.8: at least 24 by 24.
    const box = await choose.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(24);
    expect(box!.width).toBeGreaterThanOrEqual(24);

    await choose.click();
    await expect(dialog.getByRole('button', { name: 'Change' })).toBeVisible();
    await expect(dialog.getByText('Wilfredo Sanchez', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Choose / })).toHaveCount(0);
  });
}
