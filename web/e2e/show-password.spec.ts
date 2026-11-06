import { expect, test, type Page } from '@playwright/test';

/**
 * Every password box carries an eye that shows what was typed (owner, 2026-11-06): a leader
 * activating an account on a phone could not see the password being set. Hidden every time the
 * page opens, a button a screen reader names, and the typed value kept as it toggles.
 */

async function expectEye(page: Page, label: string) {
  const box = page.getByLabel(label, { exact: true });
  const show = page.getByRole('button', { name: 'Show password' });

  await box.fill('Grace upon grace 2026');
  await expect(box).toHaveAttribute('type', 'password');
  await expect(show).toHaveAttribute('aria-controls', (await box.getAttribute('id'))!);
  const size = await show.boundingBox();
  expect(size!.width).toBeGreaterThanOrEqual(44);
  expect(size!.height).toBeGreaterThanOrEqual(44);

  await show.click();
  await expect(box).toHaveAttribute('type', 'text');
  await expect(box).toHaveValue('Grace upon grace 2026');

  // By keyboard as well: the button is reached by Tab and pressed with Enter.
  const hide = page.getByRole('button', { name: 'Hide password' });
  await hide.focus();
  await page.keyboard.press('Enter');
  await expect(box).toHaveAttribute('type', 'password');
  await expect(show).toBeVisible();
}

test('activating an account shows the new password on request', async ({ page }) => {
  await page.route('**/api/v1/auth/activate/username-suggestion', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"username":"mrsantos","taken":null}' }),
  );
  await page.goto('/activate?token=example-activation-token');
  await expectEye(page, 'New password');
});

test('resetting a password shows it on request', async ({ page }) => {
  await page.goto('/reset-password?token=example-reset-token');
  await expectEye(page, 'New password');
});

test('signing in shows the password on request', async ({ page }) => {
  await page.goto('/sign-in');
  await expectEye(page, 'Password');
});

test('the password box opens hidden again after the page is reloaded', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Show password' }).click();
  await page.reload();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
});
