import { expect, test, type Page } from '@playwright/test';

/**
 * A session ends a fixed time after its sign-in, however often it is used, and the sign-in
 * page says so: thirty days, seven for an Admin or Senior Pastor (SKILL.md section 6,
 * decision 0450). The server refuses the renewal with the days in its details.
 */

async function sessionEndedByAge(page: Page, days: number) {
  // Stored once, as a real sign-in leaves it: an init script runs on every load, and
  // re-storing it would make each later page a session ending by age again.
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('seeded') === null) {
      window.sessionStorage.setItem('seeded', '1');
      window.localStorage.setItem('dfc.refresh_token', 'refresh-0');
    }
  });
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'UNAUTHENTICATED',
          message: `It has been ${days} days since you signed in on this device. Sign in again.`,
          details: { reason: 'SESSION_AGE', days },
        },
      }),
    }),
  );
}

for (const days of [30, 7]) {
  test(`opens sign-in saying it has been ${days} days, and forgets the session`, async ({
    page,
  }) => {
    await sessionEndedByAge(page, days);

    await page.goto('/session');

    await expect(page).toHaveURL(new RegExp(`/sign-in\\?reason=age&days=${days}$`));
    await expect(page.getByRole('status')).toHaveText(
      `It has been ${days} days since you signed in on this device. Sign in again to continue, to keep members’ details safe.`,
    );
    const stored = await page.evaluate(() => window.localStorage.getItem('dfc.refresh_token'));
    expect(stored).toBeNull();
  });
}

test('says it once: the sign-in page reached again later says nothing', async ({ page }) => {
  await sessionEndedByAge(page, 30);
  await page.goto('/session');
  await expect(page).toHaveURL(/reason=age/);
  await expect(page.getByRole('status')).toBeVisible();

  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('an ordinary refused renewal opens the plain sign-in page', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('dfc.refresh_token', 'refresh-0');
  });
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAUTHENTICATED', message: 'Your session has ended. Sign in again.', details: {} },
      }),
    }),
  );

  await page.goto('/session');

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('a days figure the server never gives says nothing', async ({ page }) => {
  await page.goto('/sign-in?reason=age&days=365');
  await expect(page.getByLabel('Email or username')).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
});
