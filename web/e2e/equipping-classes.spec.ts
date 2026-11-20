import { expect, test, type Page } from '@playwright/test';

import { mockCoordinator, mockSignedIn } from './mock-api';
import { mockCoordinatedClasses } from './mock-equipping';

/**
 * The Coordinator's *Classes* (SKILL.md section 29, decision 0501). `accessibility.spec.ts`
 * scans the screen; these cases pin where it is reached and what it says.
 *
 *   - on a laptop it is its own sidebar item, after SUYNL;
 *   - on a phone the bottom bar keeps five items: *Classes* is a tab beside SUYNL, under the
 *     item then named *Growth* (owner, 2026-11-20, options A);
 *   - a class with no Teacher says *Not named yet*, in words.
 */
async function openClasses(page: Page) {
  await mockSignedIn(page);
  await mockCoordinator(page);
  await mockCoordinatedClasses(page);
  await page.goto('/equipping/classes');
  await expect(page.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible();
}

test('on a laptop Classes is its own sidebar item, and a class with no Teacher says so', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openClasses(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Classes' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'SUYNL' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Life Class C/ })).toContainText('Not named yet');
  await expect(page.getByRole('row', { name: /Life Class A/ })).toContainText('Aurora Reyes');
});

test('on a phone the bar keeps five items, and Classes is a tab beside SUYNL under Growth', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openClasses(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Classes' })).toBeHidden();
  await expect(nav.getByRole('link', { name: 'Growth' })).toBeVisible();
  await expect(nav.getByRole('link').filter({ visible: true })).toHaveCount(5);
  const tabs = page.getByRole('navigation', { name: 'Growth' });
  await expect(tabs.getByRole('link', { name: 'Classes' })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('link', { name: 'SUYNL' })).toBeVisible();
});
