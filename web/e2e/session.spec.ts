import { expect, test } from '@playwright/test';

/**
 * The section 6 rules this client has to keep, none of which is visible in a
 * passing UI.
 *
 * Every one of them was a defect found by review on this branch, and every one
 * looks identical to a working application from the outside: the screen says
 * "signed out" whether or not anything was revoked, a dropped connection looks
 * like a session that ended, and a token presented twice looks like a token
 * presented once until the account is revoked on every device.
 *
 * They are pinned here rather than left to the docblocks that assert them,
 * because on this branch the docblocks have twice asserted a property the code
 * did not have.
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
test('a refresh that fails in transit is presented once, and the token is kept', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('dfc.refresh_token', 'refresh-0');
  });

  const presented: string[] = [];
  await page.route('**/api/v1/auth/refresh', (route) => {
    const body = route.request().postDataJSON() as { refresh_token: string };
    presented.push(body.refresh_token);
    return route.abort('failed');
  });

  await page.goto('/session');
  await expect(page.getByRole('button', { name: 'Try again anyway' })).toBeVisible();

  // **The count is the point of this test.** `fetch` rejects identically whether
  // the request never arrived or arrived, rotated the row, and lost the
  // response. In the second case a second presentation is section 6's reuse
  // signal and revokes the account on every device — so the client must not make
  // one on its own initiative. The query layer retries, which is what turned
  // this into three presentations before the halt existed.
  expect(presented, 're-presented a refresh token whose outcome was unknown').toEqual(['refresh-0']);

  // And it is kept, not discarded: section 23 makes an unreliable connection the
  // expected case, and a tunnel is not a revoked session.
  const stored = await page.evaluate(() => window.localStorage.getItem('dfc.refresh_token'));
  expect(stored, 'a transport failure discarded the refresh token').toBe('refresh-0');
});

/**
 * **A halt survives a page reload, because the token it guards does.**
 *
 * The guard was a module variable and the token is in `localStorage`. Those have
 * different lifetimes, and the shorter one was the guard — so reloading cleared
 * it, the client presented the token, and the server read that as reuse and
 * revoked every session on the account. No concurrency needed, and no test saw
 * it, because no case reloaded.
 */
test('a halt survives a reload, and the token is not presented again', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('dfc.refresh_token', 'refresh-0');
  });

  const presented: string[] = [];
  await page.route('**/api/v1/auth/refresh', (route) => {
    presented.push((route.request().postDataJSON() as { refresh_token: string }).refresh_token);
    return route.abort('failed');
  });

  await page.goto('/session');
  await expect(page.getByRole('button', { name: 'Try again anyway' })).toBeVisible();

  await page.reload();

  // The reload must not present it again, and the page must still know it is
  // halted rather than looking like an ordinary failure.
  await expect(page.getByRole('button', { name: 'Try again anyway' })).toBeVisible();
  expect(presented, 'a reload re-presented the token the halt was protecting').toEqual([
    'refresh-0',
  ]);
});

/**
 * The same guard, across tabs. A second tab is a second JavaScript context and
 * reads the same `localStorage`, so an in-memory halt is no guard at all there.
 */
test('a halt in one tab stops a second tab presenting the same token', async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem('dfc.refresh_token', 'refresh-0');
  });

  const presented: string[] = [];
  await context.route('**/api/v1/auth/refresh', (route) => {
    presented.push((route.request().postDataJSON() as { refresh_token: string }).refresh_token);
    return route.abort('failed');
  });

  const first = await context.newPage();
  await first.goto('/session');
  await expect(first.getByRole('button', { name: 'Try again anyway' })).toBeVisible();

  const second = await context.newPage();
  await second.goto('/session');
  await expect(second.getByRole('button', { name: 'Try again anyway' })).toBeVisible();

  expect(presented, 'a second tab re-presented a halted token').toEqual(['refresh-0']);
});

/**
 * The halt is not a dead end: pressing *Try again* is the person choosing to
 * present the token a second time, knowing the first attempt's outcome is
 * unknown. That is a different act from the client doing it unprompted, and it
 * is the only thing that clears the halt.
 */
test('a halted session is resumable by a deliberate retry', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('dfc.refresh_token', 'refresh-0');
  });

  let failNext = true;
  const presented: string[] = [];
  await page.route('**/api/v1/auth/refresh', (route) => {
    const body = route.request().postDataJSON() as { refresh_token: string };
    presented.push(body.refresh_token);

    if (failNext) {
      failNext = false;
      return route.abort('failed');
    }

    return route.fulfill(tokens('access-1', 'refresh-1'));
  });

  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }),
  );

  await page.goto('/session');
  await page.getByRole('button', { name: 'Try again anyway' }).click();

  // The fixture carries no capabilities, so the page renders its empty state
  // rather than a table. The email is what proves `/auth/me` was reached.
  await expect(page.getByText('admin@example.invalid')).toBeVisible();
  expect(presented).toEqual(['refresh-0', 'refresh-0']);
});

/**
 * **The cross-tab lock, which nothing else here reaches.**
 *
 * `inFlight` collapses concurrent refreshes within one tab. It cannot help
 * across tabs: `localStorage` is shared per origin while `inFlight` is per
 * JavaScript context, so two tabs opening together each read the same token and
 * each POST it. The second arrives after the first has rotated — sequential at
 * the server, so the 2026-08-21 simultaneous exemption does not apply — and
 * section 6 revokes every session on the account.
 *
 * This is the only case that fails if `withSessionLock` is removed, which is why
 * it exists: every other case in this file passes against a client with no lock
 * at all, because they each drive a single tab.
 *
 * **The first response is held until the second tab has actually loaded**, rather
 * than for a fixed delay. A timer makes the race probabilistic: on a loaded CI
 * runner the second tab may start late, the first rotation completes before it
 * reads, and the test then passes against a client with no lock at all. A
 * barrier makes the window certain, so a failure means the lock is missing
 * rather than that the machine was fast.
 */
test('two tabs never present the same refresh token', async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem('dfc.refresh_token', 'refresh-0');
  });

  let rotations = 0;
  const presented: string[] = [];

  let releaseFirst: () => void;
  const firstMayAnswer = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  await context.route('**/api/v1/auth/refresh', async (route) => {
    const body = route.request().postDataJSON() as { refresh_token: string };
    presented.push(body.refresh_token);

    // Hold the first rotation open until the second tab is up. Without the lock
    // that tab reads the same stored token and presents it; with the lock it
    // waits here and then reads the rotated one.
    if (presented.length === 1) {
      await firstMayAnswer;
    }

    rotations += 1;
    await route.fulfill(tokens(`access-${rotations}`, `refresh-${rotations}`));
  });

  await context.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }),
  );

  const first = await context.newPage();
  const second = await context.newPage();

  const loads = Promise.all([first.goto('/session'), second.goto('/session')]);

  // Both tabs are now past the point where an unlocked client would have read
  // the stored token. Release the first rotation and let them settle.
  await expect
    .poll(() => presented.length, { message: 'the first tab never presented a token' })
    .toBeGreaterThanOrEqual(1);
  await second.waitForLoadState('domcontentloaded');
  releaseFirst!();
  await loads;

  await expect(first.getByText('admin@example.invalid')).toBeVisible();
  await expect(second.getByText('admin@example.invalid')).toBeVisible();

  // Both tabs really did refresh — otherwise this passes by one of them never
  // having needed a token at all.
  expect(presented.length, 'only one tab refreshed, so nothing was serialized').toBeGreaterThanOrEqual(2);

  // The assertion that matters: no value was presented twice.
  expect(
    new Set(presented).size,
    `a refresh token was presented more than once across tabs: ${presented.join(', ')}`,
  ).toBe(presented.length);
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
