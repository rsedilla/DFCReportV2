import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The offline page (SKILL.md section 23, decision 0497): opened with no connection, DREAMS shows
 * its own page in place of the browser's, and opens by itself when the connection is back. The
 * helper keeps that page and the logo, and nothing else of the application.
 */

// Every other suite runs without the helper (`playwright.config.ts`); this one is about it.
test.use({ serviceWorkers: 'allow' });

/** Opens the sign-in screen and waits until the helper answers for the page. */
async function openWithHelper(page: import('@playwright/test').Page) {
  await page.goto('/sign-in');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      );
    }
  });
}

test('opened with no connection, DREAMS shows its offline page, and returns by itself', async ({
  page,
  context,
}) => {
  await openWithHelper(page);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
  await expect(page.getByText('Your attendance marks are safe.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  // The page stands at the address that was asked for, so trying again asks for it again.
  expect(new URL(page.url()).pathname).toBe('/sign-in');
  // The logo is kept with the page, so it is drawn with no connection.
  await expect
    .poll(() => page.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);

  // Still offline: Try again shows the page again and not the browser's own.
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toHaveCount(0);
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
});

test('the helper keeps the offline page and the logo, and nothing else', async ({ page }) => {
  await openWithHelper(page);

  const kept = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        paths.push(new URL(request.url).pathname);
      }
    }
    return paths.sort();
  });

  expect(kept).toEqual(['/dreams-logo-168.png', '/offline.html']);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the offline page has no accessibility violation in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    // The file itself: axe reads the page, however it came to be shown.
    await page.goto('/offline.html');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    const button = await page.getByRole('button', { name: 'Try again' }).boundingBox();
    expect(button!.height).toBeGreaterThanOrEqual(24);
  });
}
