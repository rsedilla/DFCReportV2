import { expect, test, type Page } from '@playwright/test';

import { RECOVERY_CODES, SECOND_STEP_CODE, mockSecondStep } from './mock-api';

/**
 * The second sign-in step of an administrator or Senior Pastor (SKILL.md section 6,
 * decision 0302), against a fake of the API's answers.
 */

async function signInWithPassword(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('admin@example.invalid');
  await page.getByLabel('Password').fill('a-password-for-this-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('asks for the code after the password, and signs in with it', async ({ page }) => {
  await mockSecondStep(page, 'CODE');
  await signInWithPassword(page);

  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  const code = page.getByLabel('Code');
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(code).toHaveAttribute('inputmode', 'numeric');

  await code.fill('000000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('That code did not work. 4 tries left')).toBeVisible();

  await code.fill(SECOND_STEP_CODE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('accepts a pasted code', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Clipboard permissions are Chromium-only in Playwright.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockSecondStep(page, 'CODE');
  await signInWithPassword(page);

  await page.evaluate((value) => navigator.clipboard.writeText(value), SECOND_STEP_CODE);
  await page.getByLabel('Code').focus();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(page.getByLabel('Code')).toHaveValue(SECOND_STEP_CODE);
});

test('offers a recovery code instead, and says who resets a lost phone', async ({ page }) => {
  await mockSecondStep(page, 'CODE');
  await signInWithPassword(page);

  await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await expect(page.getByRole('heading', { name: 'Use a recovery code' })).toBeVisible();
  await expect(page.getByText('ask an administrator to reset your second step')).toBeVisible();

  await page.getByLabel('Recovery code').fill(RECOVERY_CODES[0]);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('walks through setup and shows the recovery codes once, before going on', async ({ page }) => {
  await mockSecondStep(page, 'SETUP');
  await signInWithPassword(page);

  await expect(page.getByRole('heading', { name: 'Set up your second step' })).toBeVisible();
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  await expect(page.getByText('JBSW Y3DP EHPK 3PXP')).toBeVisible();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Step 2 of 2.')).toBeVisible();
  await page.getByLabel('Code').fill(SECOND_STEP_CODE);
  await page.getByRole('button', { name: 'Confirm' }).click();

  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem')).toHaveCount(10);

  const go = page.getByRole('button', { name: 'Continue to DFC Report' });
  await expect(go).toBeDisabled();
  await page.getByLabel('I have saved these codes somewhere safe').check();
  await go.click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

/**
 * WCAG 2.5.8 for the controls these screens add, which `accessibility.spec.ts` cannot
 * reach because each is behind a password.
 */
test('every control on the second-step screens is at least 24 by 24 pixels', async ({ page }) => {
  const measure = async (locator: import('@playwright/test').Locator, name: string) => {
    const box = await locator.boundingBox();
    expect(box, `${name} has no box`).not.toBeNull();
    expect(box!.width, `${name} is narrower than 24px`).toBeGreaterThanOrEqual(24);
    expect(box!.height, `${name} is shorter than 24px`).toBeGreaterThanOrEqual(24);
  };

  await mockSecondStep(page, 'SETUP');
  await signInWithPassword(page);
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  await measure(page.getByRole('button', { name: 'Copy key' }), 'Copy key');
  await measure(page.getByRole('button', { name: 'Next' }), 'Next');

  await page.getByRole('button', { name: 'Next' }).click();
  await measure(page.getByLabel('Code'), 'the code field');
  await measure(page.getByRole('button', { name: 'Confirm' }), 'Confirm');
  await measure(page.getByRole('button', { name: 'Back to the QR code' }), 'Back to the QR code');

  await page.getByLabel('Code').fill(SECOND_STEP_CODE);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await measure(page.getByRole('button', { name: 'Copy all' }), 'Copy all');
  await measure(page.getByRole('link', { name: 'Download' }), 'Download');
  await measure(page.getByLabel('I have saved these codes somewhere safe'), 'the checkbox');
});

test('goes back to the password when the sign-in has expired', async ({ page }) => {
  await mockSecondStep(page, 'CODE');
  await page.route('**/api/v1/auth/second-step', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'This sign-in has expired. Sign in again.',
          details: { reason: 'SIGN_IN_AGAIN' },
        },
      }),
    }),
  );
  await signInWithPassword(page);

  await page.getByLabel('Code').fill(SECOND_STEP_CODE);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('This sign-in has expired. Sign in again.')).toBeVisible();
});
