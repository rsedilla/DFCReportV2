import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import { mockCandidate, mockEquipping, mockRegistrar, mockRegistrationSearch } from './mock-equipping';

/**
 * A student taking Life Class again (SKILL.md section 29, decision 0511): *2nd try* beside the
 * name on Registration and on Enrollment's *Ready to enroll*, and *Took Life Class before* on the
 * Register form. The API works it out from posted grades; the screen only says it.
 */
async function open(page: Page, path: string, width = 1280, tries = true) {
  await page.setViewportSize({ width, height: 900 });
  await mockSignedIn(page);
  await mockRegistrar(page);
  await mockEquipping(page, { tries });
  await mockRegistrationSearch(page);
  await page.goto(path);
}

test('Registration says 2nd try beside the name, and nothing for a first try', async ({ page }) => {
  await open(page, '/equipping/registration');
  await expect(page.getByRole('row', { name: /Manalo, Carlito/ })).toContainText('Manalo, Carlito · 2nd try');
  await expect(page.getByRole('row', { name: /Flores, Danica/ })).not.toContainText('try');
});

test('Ready to enroll says 2nd try, on a laptop and on a phone', async ({ page }) => {
  await open(page, '/equipping/enrollment');
  await expect(page.getByRole('row', { name: /Lim, Ernesto/ })).toContainText('Lim, Ernesto · 2nd try');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('listitem').filter({ hasText: 'Lim, Ernesto' }).first()).toContainText('2nd try');
});

for (const [tries, shown] of [
  [true, true],
  [false, false],
] as const) {
  test(`the Register form ${shown ? 'lists each earlier try' : 'shows nothing for a first try'}`, async ({ page }) => {
    await open(page, '/equipping/registration', 1280, tries);
    await mockCandidate(page, tries);
    await page.getByRole('button', { name: 'Register for Life Class' }).click();
    const dialog = page.getByRole('dialog', { name: 'Register for Life Class' });
    await dialog.getByLabel('Person').fill('wil');
    await dialog.getByRole('button', { name: 'Search' }).click();
    await dialog.getByRole('button', { name: 'Choose Wilfredo Sanchez' }).click();
    await expect(dialog.getByRole('heading', { name: 'Requirements' })).toBeVisible();
    const box = dialog.getByRole('region', { name: 'Took Life Class before' });
    if (!shown) {
      await expect(box).toHaveCount(0);
      return;
    }
    await expect(box.getByRole('listitem')).toHaveText([
      'Term 1, 2026 · Life Class B · Not passed · More than three absences',
      'Term 2, 2026 · Life Class A · Not passed · Missed three of lessons 1 to 4',
    ]);
    await expect(box).toContainText('This will be their 3rd try. Every try is kept; there is no limit.');
    // No limit: Register stays offered.
    await expect(dialog.getByRole('button', { name: 'Register', exact: true })).toBeVisible();
  });
}
