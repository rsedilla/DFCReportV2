import { expect, test } from '@playwright/test';

import { mockSignedIn } from './mock-api';

/**
 * The signed-in screens share one shell, drawn by `app/(app)/layout.tsx`, so a click in the
 * sidebar swaps the page and leaves the sidebar and its logo as they are (owner, 2026-11-05:
 * the logo blinked on every click when each page drew its own).
 */

test('the sidebar and its logo are not drawn again when a sidebar link is followed', async ({ page }) => {
  await mockSignedIn(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dashboard');

  const navigation = page.getByRole('navigation', { name: 'Main' });
  await expect(navigation.getByRole('link').first()).toBeVisible();

  // Mark the elements on this page; a shell drawn again would come back without the marks.
  await page.evaluate(() => {
    document.querySelector('nav[aria-label="Main"]')?.setAttribute('data-kept', 'yes');
    document.querySelectorAll('img[src*="dreams-logo"]').forEach((logo) => logo.setAttribute('data-kept', 'yes'));
  });

  const second = navigation.getByRole('link').nth(1);
  const target = await second.getAttribute('href');
  await second.click();
  await expect(page).toHaveURL(new RegExp(`${target}$`));

  await expect(page.locator('nav[aria-label="Main"][data-kept="yes"]')).toHaveCount(1);
  await expect(page.locator('img[src*="dreams-logo"]:not([data-kept="yes"])')).toHaveCount(0);
  await expect(page.locator('img[src*="dreams-logo"][data-kept="yes"]').first()).toBeAttached();
});

test('the sidebar shows the small copy of the logo', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto('/dashboard');
  await expect(page.locator('img[src="/dreams-logo-168.png"]').first()).toBeAttached();
});
