import { expect, test } from '@playwright/test';

/**
 * An emailed link's code leaves the address once the page has read it, and is kept in the tab
 * so a reload still works (SKILL.md section 6, decision 0447). Invented values.
 */

const LINKS = [
  { route: '/activate', token: 'example-activation-token', ready: 'Activate account' },
  { route: '/reset-password', token: 'example-reset-token', ready: 'Save' },
  { route: '/confirm-email', token: 'example-email-token', ready: 'Confirm Email' },
];

for (const link of LINKS) {
  test(`${link.route} takes the code out of the address and keeps it across a reload`, async ({ page }) => {
    await page.route('**/api/v1/auth/activate/username-suggestion', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"username":"rbsantiago","taken":null}' }),
    );
    await page.goto(`${link.route}?token=${link.token}`);
    await expect(page.getByRole('button', { name: link.ready, exact: true })).toBeVisible();
    await expect.poll(() => page.url()).not.toContain('token');
    expect(new URL(page.url()).pathname).toBe(link.route);

    await page.reload();
    await expect(page.getByRole('button', { name: link.ready, exact: true })).toBeVisible();
    await expect(page.getByText(/missing its token/)).toHaveCount(0);
  });
}

test('a used reset link is forgotten by the tab', async ({ page }) => {
  const sent: unknown[] = [];
  await page.route('**/api/v1/auth/reset-password', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto('/reset-password?token=example-reset-token');
  await expect.poll(() => page.url()).not.toContain('token');
  await page.getByLabel('New password', { exact: true }).fill('a long enough passphrase');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Your password has been changed')).toBeVisible();
  expect(sent[0]).toMatchObject({ token: 'example-reset-token' });

  await page.reload();
  await expect(page.getByText(/missing its token/)).toBeVisible();
});

test('a link opened without a code still says so', async ({ page }) => {
  await page.goto('/confirm-email');
  await expect(page.getByText(/missing its token/)).toBeVisible();
});
