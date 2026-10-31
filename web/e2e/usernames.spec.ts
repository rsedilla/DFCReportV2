import { expect, test } from '@playwright/test';

import { mockSignedIn } from './mock-api';

/**
 * Usernames on the three screens that carry them (SKILL.md section 6, decision 0337): sign-in
 * takes one, activation asks for one, and the Account page offers one. Invented names.
 */

const ME = {
  account_id: '4f8c1d6a-0f1e-4b2a-9c3d-5e6f7a8b9c0d',
  person_id: '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9',
  email: 'rogelio@example.invalid',
  first_name: 'Rogelio',
  roles: ['LEADER'],
  screens: 'FULL',
  people_i_oversee: true,
  capabilities: [],
};

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

test('signs in with a username, sending it as a username', async ({ page }) => {
  const sent: unknown[] = [];
  await page.route('**/api/v1/auth/login', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill(
      json({ access_token: 'a', refresh_token: 'r', token_type: 'Bearer', expires_in: 900 }),
    );
  });
  await page.route('**/api/v1/auth/me', (route) => route.fulfill(json({ ...ME, username: 'rbsantiago' })));

  await page.goto('/sign-in');
  await page.getByLabel('Email or username').fill('rbsantiago');
  await page.getByLabel('Password').fill('a long enough passphrase');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ username: 'rbsantiago' });
  expect(sent[0]).not.toHaveProperty('email');
});

test('names a username in the refusal when a username was typed', async ({ page }) => {
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill(
      json({ error: { code: 'UNAUTHENTICATED', message: 'Username or password is incorrect.', details: {} } }, 401),
    ),
  );

  await page.goto('/sign-in');
  await page.getByLabel('Email or username').fill('rbsantiago');
  await page.getByLabel('Password').fill('not the right passphrase');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText('That username and password do not match an account.')).toBeVisible();
});

test('activation fills the suggestion, says when it moved, and sends the username', async ({ page }) => {
  const sent: unknown[] = [];
  await page.route('**/api/v1/auth/activate/username-suggestion', (route) =>
    route.fulfill(json({ username: 'rbsantiago2', taken: 'rbsantiago' })),
  );
  await page.route('**/api/v1/auth/activate', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/activate?token=example-activation-token');

  const field = page.getByLabel('Username');
  await expect(field).toHaveValue('rbsantiago2');
  await expect(page.getByText(/rbsantiago is already taken, so a number was added/)).toBeVisible();

  await page.getByLabel('New password').fill('a long enough passphrase');
  await page.getByRole('button', { name: 'Activate account' }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({
    token: 'example-activation-token',
    password: 'a long enough passphrase',
    username: 'rbsantiago2',
  });
});

test('the Account page offers a username and saves it with a key', async ({ page }) => {
  await mockSignedIn(page);
  let current: string | null = null;
  await page.route('**/api/v1/auth/me', (route) => route.fulfill(json({ ...ME, username: current })));
  await page.route('**/api/v1/auth/username-suggestion', (route) =>
    route.fulfill(json({ username: 'rbsantiago', taken: null })),
  );
  const keys: (string | undefined)[] = [];
  await page.route('**/api/v1/auth/username', (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    current = (route.request().postDataJSON() as { username: string }).username;
    return route.fulfill(json({ username: current }));
  });

  await page.goto('/session');
  const section = page.getByRole('region', { name: 'Username' });
  await expect(section.getByLabel('Username')).toHaveValue('rbsantiago');
  await expect(section.getByText('Optional. Sign in with it or with your email address.')).toBeVisible();

  await section.getByRole('button', { name: 'Save username' }).click();

  await expect(section.getByText('rbsantiago', { exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Change username' })).toBeVisible();
  expect(keys).toHaveLength(1);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
});

/**
 * Ten wrong passwords pause the name (decision 0413). Its own words reach the screen, because
 * they name the way in that still works; any other limit keeps the minute's wording.
 */
test('shows the pause in its own words, and any other limit as a minute', async ({ page }) => {
  const paused =
    'Sign-in for this username is paused for 15 minutes after 10 wrong passwords. To get in now, use "I have forgotten my password".';
  let reason: string | undefined = 'SIGN_IN_PAUSED';
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill(
      json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: reason === undefined ? 'Too many requests. Try again shortly.' : paused,
            details: reason === undefined ? {} : { reason },
          },
        },
        429,
      ),
    ),
  );

  await page.goto('/sign-in');
  await page.getByLabel('Email or username').fill('rbsantiago');
  await page.getByLabel('Password').fill('not the right passphrase');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText(paused);

  reason = undefined;
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText(
    'Too many attempts. Wait a minute and try again.',
  );
});

/**
 * A completed reset answers with a proof this browser keeps, and the next sign-in sends it, so
 * this browser gets through a pause for fifteen minutes (decision 0413).
 */
test('keeps the proof a reset answers with, and sends it when signing in', async ({ page }) => {
  await page.route('**/api/v1/auth/reset-password', (route) =>
    route.fulfill(json({ sign_in_proof: 'proof-from-the-reset' })),
  );
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/v1/auth/login', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill(
      json({ error: { code: 'UNAUTHENTICATED', message: 'Username or password is incorrect.', details: {} } }, 401),
    );
  });

  await page.goto('/reset-password?token=example-reset-token');
  await page.getByLabel('New password', { exact: true }).fill('a long enough passphrase');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('Your password has been changed')).toBeVisible();

  await page.goto('/sign-in');
  await page.getByLabel('Email or username').fill('rbsantiago');
  await page.getByLabel('Password').fill('a long enough passphrase');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ username: 'rbsantiago', reset_proof: 'proof-from-the-reset' });
});
