import { expect, test } from '@playwright/test';

import { mockPeople, mockSignedIn } from './mock-api';

/**
 * DREAMS, Doulos Reporting, Evaluation, And Management System, and the DfC globe (owner's
 * choice of 2026-10-19): on the sign-in screen, in the sidebar, as the tab's title and icon,
 * and as the name a phone gives the site on its home screen.
 */
const FULL_NAME = 'Doulos Reporting, Evaluation, And Management System';

test('the sign-in screen carries the logo, the name and a welcome', async ({ page }) => {
  await page.goto('/sign-in');

  await expect(page).toHaveTitle('DREAMS');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome. Sign in to continue.');
  await expect(page.getByText('DREAMS', { exact: true })).toBeVisible();
  await expect(page.getByText(FULL_NAME)).toBeVisible();
  // Decorative beside the name, so it is not announced a second time.
  const logo = page.locator('main img');
  await expect(logo).toHaveAttribute('alt', '');
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});

test('the sidebar names DREAMS beside the logo, from lg', async ({ page }) => {
  await mockSignedIn(page);
  await mockPeople(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto('/people');

  await expect(page.getByText('DREAMS', { exact: true }).locator('visible=true')).toHaveCount(1);
  await expect(page.getByText(FULL_NAME)).toBeVisible();
});

test('the tab icon and the home-screen manifest are served', async ({ page, request }) => {
  await page.goto('/sign-in');
  const icon = await page.locator('link[rel="icon"]').first().getAttribute('href');
  expect(icon).toBeTruthy();
  expect((await request.get(icon!)).status()).toBe(200);

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(href!)).json();
  expect(manifest.short_name).toBe('DREAMS');
  expect(manifest.name).toContain(FULL_NAME);
  for (const { src } of manifest.icons as { src: string }[]) {
    expect((await request.get(src)).status()).toBe(200);
  }
});
