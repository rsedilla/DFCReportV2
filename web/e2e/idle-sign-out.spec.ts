import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn } from './mock-api';

/**
 * A browser session signs out after thirty minutes without activity, with a warning at
 * twenty-eight, and the installed home-screen app is left alone (SKILL.md section 6,
 * decision 0435). The clock is Playwright's, run forward; nothing waits half an hour.
 */

const MINUTE = 60 * 1000;

async function arrange(page: Page) {
  await page.clock.install({ time: new Date('2026-11-04T02:00:00Z') });
  await mockSignedIn(page);
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ status: 204, body: '' }));
}

/**
 * Runs the page as an installed app: standalone, on a phone (a finger the main pointer) or a
 * computer (a mouse).
 */
async function installedOn(page: Page, device: 'phone' | 'computer') {
  await page.addInitScript((coarse) => {
    const real = window.matchMedia.bind(window);
    const answer = (query: string, matches: boolean) =>
      ({ ...real(query), matches, media: query }) as MediaQueryList;
    window.matchMedia = (query: string) =>
      query === '(display-mode: standalone)'
        ? answer(query, true)
        : query === '(pointer: coarse)'
          ? answer(query, coarse)
          : real(query);
  }, device === 'phone');
}

/** Runs the clock forward with nobody touching the page. */
async function idleFor(page: Page, ms: number) {
  await page.clock.runFor(ms);
}

test.describe('idle sign-out (decision 0435)', () => {
  test('warns at twenty-eight minutes, and Stay signed in keeps the session', async ({ page }) => {
    await arrange(page);
    await page.goto('/session');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await idleFor(page, 27 * MINUTE);
    await expect(page.getByRole('dialog', { name: 'Are you still there?' })).toHaveCount(0);

    await idleFor(page, 1 * MINUTE + 1000);
    const dialog = page.getByRole('dialog', { name: 'Are you still there?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('You’ll be signed out in');
    await expect(dialog).toContainText('Attendance marks you haven’t saved will be cleared.');
    // Enter keeps the session rather than ending it, and the box says what it is about.
    await expect(dialog.getByRole('button', { name: 'Stay signed in' })).toBeFocused();
    await expect(dialog).toHaveAccessibleDescription(/signed out in .* members’ details safe/);

    await dialog.getByRole('button', { name: 'Stay signed in' }).click();
    await expect(dialog).toHaveCount(0);

    // A fresh thirty minutes from the click.
    await idleFor(page, 27 * MINUTE);
    await expect(page).toHaveURL(/\/session$/);
    await expect(page.getByRole('dialog', { name: 'Are you still there?' })).toHaveCount(0);
  });

  test('signs out at thirty minutes, and the sign-in page says why', async ({ page }) => {
    await arrange(page);
    const loggedOut: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/auth/logout')) {
        loggedOut.push(request.url());
      }
    });
    await page.goto('/session');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await idleFor(page, 30 * MINUTE + 2000);

    await expect(page).toHaveURL(/\/sign-in\?reason=idle$/);
    await expect(page.getByRole('status')).toHaveText(
      'You were signed out after 30 minutes without activity, to keep members’ details safe. Sign in again to continue.',
    );
    expect(loggedOut.length).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('dfc.refresh_token'))).toBeNull();
  });

  test('counts activity in the page, so somebody working is never warned, and renews for them', async ({
    page,
  }) => {
    await arrange(page);
    // A renewal notes the time twice: as it is sent, and as it ends. Counted here so each can
    // be waited for, since one ending after the clock has jumped would be noted twenty
    // minutes late, and the next move would then seem too soon to renew.
    await page.addInitScript(() => {
      const write = Storage.prototype.setItem;
      const counted = window as unknown as { renewalNotes: number };
      counted.renewalNotes = 0;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'dfc.renewed_at') {
          counted.renewalNotes += 1;
        }
        write.call(this, key, value);
      };
    });
    let refreshes = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/auth/refresh')) {
        refreshes += 1;
      }
    });
    await page.goto('/session');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const before = refreshes;

    for (let step = 0; step < 4; step += 1) {
      await idleFor(page, 20 * MINUTE);
      await page.evaluate(() => {
        (window as unknown as { renewalNotes: number }).renewalNotes = 0;
      });
      await page.mouse.move(100 + step * 10, 200);
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { renewalNotes: number }).renewalNotes))
        .toBe(2);
    }

    // Each move came twenty minutes after the last renewal, so each renewed the session and
    // the server's deadline moved on with it.
    await expect.poll(() => refreshes - before).toBeGreaterThanOrEqual(4);

    await expect(page).toHaveURL(/\/session$/);
    await expect(page.getByRole('dialog', { name: 'Are you still there?' })).toHaveCount(0);
  });

  test('leaves the app installed on a phone alone', async ({ page }) => {
    await installedOn(page, 'phone');
    await arrange(page);
    const loggedOut: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/auth/logout')) {
        loggedOut.push(request.url());
      }
    });
    await page.goto('/session');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await idleFor(page, 28 * MINUTE + 1000);
    await expect(page.getByRole('dialog', { name: 'Are you still there?' })).toHaveCount(0);
    await idleFor(page, 17 * MINUTE);
    // Settled: a sign-out, had one begun, would have reached the server and the storage.
    await page.waitForTimeout(1500);

    expect(loggedOut).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('dfc.refresh_token'))).not.toBeNull();
    await expect(page).toHaveURL(/\/session$/);
  });

  test('tells the server a browser sign-in is a browser one', async ({ page }) => {
    const sent: unknown[] = [];
    await page.route('**/api/v1/auth/login', async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'No.' } } });
    });
    await page.goto('/sign-in');

    await page.getByLabel('Email or username').fill('leader@example.test');
    await page.getByLabel('Password', { exact: true }).fill('an-invented-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ session_kind: 'BROWSER' });
  });

  test('signs out an app installed on a computer, as a browser (owner, 2026-11-04)', async ({ page }) => {
    await installedOn(page, 'computer');
    await arrange(page);
    await page.goto('/session');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await idleFor(page, 28 * MINUTE + 1000);
    await expect(page.getByRole('dialog', { name: 'Are you still there?' })).toBeVisible();
    await idleFor(page, 2 * MINUTE + 1000);
    await expect(page).toHaveURL(/\/sign-in\?reason=idle$/);
  });
});
