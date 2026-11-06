import { expect, test } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import { mockMeetingRoster } from './mock-attendance';

/**
 * Small things a person notices on a phone (owner, 2026-11-06): a field that zooms an iPhone,
 * the browser bar's colour, the installed app's icon and opening colour, a second "who am I"
 * on opening, and a logo checked with the server on every load.
 */

const MEETING = '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings/2026-06-27';

test('a note box drawn with small text is still 16px, so an iPhone does not zoom on it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSignedIn(page);
  await mockMeetingRoster(page);
  await page.goto(MEETING);
  await page.getByRole('radio', { name: 'Did not meet' }).check();

  const note = page.getByLabel(/What happened\?/);
  await expect(note).toBeVisible();
  await expect(note).toHaveClass(/text-sm/);
  expect(await note.evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
});

test("the browser bar takes the header's emerald", async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#006b35');
});

test('the installed app opens on emerald, with an icon Android can fit to its shape', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.background_color).toBe('#006b35');
  expect(manifest.icons).toContainEqual(
    expect.objectContaining({ src: '/dreams-maskable-512.png', purpose: 'maskable' }),
  );
  expect((await request.get('/dreams-maskable-512.png')).status()).toBe(200);
});

test('opening the app asks who is signed in once, and the screen it lands on reuses the answer', async ({ page }) => {
  await mockSignedIn(page);
  let asked = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/auth/me')) asked += 1;
  });

  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link').first()).toBeAttached();
  await page.waitForTimeout(500);
  expect(asked).toBe(1);
});

test('the logo is kept by the browser for a week', async ({ request }) => {
  const logo = await request.get('/dreams-logo.png');
  expect(logo.headers()['cache-control']).toBe('public, max-age=604800');
});
