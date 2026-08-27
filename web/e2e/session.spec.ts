import { expect, test } from '@playwright/test';

/**
 * Two rules from SKILL.md section 6 that are invisible in a passing UI.
 *
 * Both were defects found by review on this branch, and both look identical to a
 * working application from the outside: the screen says "signed out" either way,
 * and a dropped connection looks like a session that ended. So they are pinned
 * here rather than left to the docblocks that assert them.
 */

const SESSION = {
  account_id: '4f8c1d6a-0f1e-4b2a-9c3d-5e6f7a8b9c0d',
  person_id: '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9',
  email: 'admin@example.invalid',
  capabilities: [],
};

function tokens(access: string, refresh: string) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: 900,
    }),
  };
}

/**
 * **Signing out must present the refresh token the session currently holds.**
 *
 * `POST /auth/logout` revokes the row it is handed only while that row is still
 * live: `TokensService.revokeRefreshToken` carries `revoked_at is null`
 * deliberately, so a sign-out cannot touch a token that was already rotated. So
 * presenting a token captured *before* a rotation revokes nothing at all — the
 * replacement stays valid for its full thirty days while the person is shown a
 * signed-out screen and believes the session ended.
 *
 * The path exercised is the ordinary one: the access token expires, `logout`
 * answers 401, the client rotates, and retries. The question is which refresh
 * token the retry carries.
 */
test('sign-out presents the refresh token held after a rotation, not before it', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('dfc.refresh_token', 'refresh-0');
  });

  let refreshes = 0;
  await page.route('**/api/v1/auth/refresh', (route) => {
    refreshes += 1;
    route.fulfill(tokens(`access-${refreshes}`, `refresh-${refreshes}`));
  });

  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }),
  );

  const presented: string[] = [];
  await page.route('**/api/v1/auth/logout', (route) => {
    const body = route.request().postDataJSON() as { refresh_token: string };
    presented.push(body.refresh_token);

    // The first attempt meets an expired access token, which is what forces the
    // rotation this test is about.
    if (presented.length === 1) {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'UNAUTHENTICATED', message: 'Token expired.', details: {} },
        }),
      });
    }

    return route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/session');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL('**/sign-in');

  expect(presented.length, 'sign-out did not retry after the 401').toBe(2);

  // The retry must carry what the rotation stored. Before the fix it carried the
  // value read at the top of `signOut`, which by then was revoked — so the
  // server matched nothing and the live token survived.
  const [, retried] = presented;
  expect(retried, 'the retry presented a token that had already been rotated').toBe(
    `refresh-${refreshes}`,
  );
  expect(retried).not.toBe('refresh-0');
});

/**
 * **A dropped connection is not a revoked session.**
 *
 * Section 23 makes an unreliable connection the expected case for this
 * application, and section 2 makes mobile web a current surface. Discarding a
 * live refresh token because a request failed in transit signs a leader out of a
 * session the server never ended, and they cannot get back in without their
 * password.
 *
 * Only a 401 discards the credential.
 */
test('a refresh that fails in transit leaves the stored token alone', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('dfc.refresh_token', 'refresh-0');
  });

  await page.route('**/api/v1/auth/refresh', (route) => route.abort('failed'));

  await page.goto('/session');
  await expect(page.getByRole('alert').filter({ hasText: 'connection' })).toBeVisible();

  const stored = await page.evaluate(() => window.localStorage.getItem('dfc.refresh_token'));
  expect(stored, 'a transport failure discarded the refresh token').toBe('refresh-0');
});

/**
 * The same rule from the other side: a *refused* refresh token is discarded,
 * because it cannot be retried and presenting it again is what section 6 makes
 * expensive.
 *
 * Without this, the test above would pass against a client that never discards
 * anything.
 */
test('a refresh refused with 401 discards the stored token', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('dfc.refresh_token', 'refresh-0');
  });

  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNAUTHENTICATED', message: 'Refresh token is not valid.', details: {} },
      }),
    }),
  );

  await page.goto('/session');
  await page.waitForURL('**/sign-in');

  const stored = await page.evaluate(() => window.localStorage.getItem('dfc.refresh_token'));
  expect(stored, 'a refused refresh token was kept').toBeNull();
});
