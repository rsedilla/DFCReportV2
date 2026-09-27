import { expect, type Page, test } from '@playwright/test';

import { mockPeople, mockSignedIn } from './mock-api';

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
  first_name: 'Marilou',
  roles: ['LEADER'],
  capabilities: [],
};

/** What `SessionHaltBanner` and `SessionHaltedError` both say. */
const HALT_SENTENCE =
  'Your connection dropped while keeping you signed in. Sign in again to carry on.';

/**
 * The banner, told apart from a screen's own failure notice, which carries the same
 * sentence (it is `SessionHaltedError`'s message) and no button.
 */
function haltBanner(page: Page) {
  return page
    .getByRole('alert')
    .filter({ hasText: HALT_SENTENCE })
    .filter({ has: page.getByRole('button', { name: 'Sign in again' }) });
}

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
 * **A dropped connection is not a revoked session, and a lost answer is retried once.**
 *
 * Section 23 makes an unreliable connection the expected case for this
 * application, and section 2 makes mobile web a current surface. Discarding a
 * live refresh token because a request failed in transit signs a leader out of a
 * session the server never ended.
 *
 * **The count is the point of this test.** `fetch` rejects identically whether the
 * request never arrived or arrived, rotated the row, and lost the response. Section
 * 6 serves exactly one re-presentation of a rotated token whose replacement was
 * never used (decision 0128); a second is the reuse signal and revokes the account
 * on every device. So the client presents the token once more and then stops, and
 * the query layer's own retries must not turn that into a third presentation.
 */
test('a refresh that fails in transit is presented once more, then halts, and the token is kept', async ({
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
  await expect(page.getByRole('button', { name: 'Sign in again' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Try again anyway' })).toHaveCount(0);

  expect(presented, 'the token was not presented exactly twice').toEqual(['refresh-0', 'refresh-0']);

  // And it is kept, not discarded: a tunnel is not a revoked session.
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
  await expect(page.getByRole('button', { name: 'Sign in again' })).toBeVisible({ timeout: 15_000 });

  await page.reload();

  // The reload must not present it again, and the page must still know it is
  // halted rather than looking like an ordinary failure.
  await expect(page.getByRole('button', { name: 'Sign in again' })).toBeVisible();
  await page.waitForTimeout(4_000);
  expect(presented, 'a reload re-presented the token the halt was protecting').toEqual([
    'refresh-0',
    'refresh-0',
  ]);
});

/**
 * **The same limit across a reload that lands between the failure and its retry.**
 *
 * The halt is written only once the retry has failed, so it cannot guard the pause
 * before the retry. A page reloaded inside that pause starts afresh, presents the
 * token as though for the first time, and — if that answer is lost too — presents
 * it again: three presentations of one token, the third of which section 6 reads
 * as reuse (decision 0128: "nothing is served twice").
 */
test('a reload between the failure and its retry does not present the token a third time', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('dfc.refresh_token', 'refresh-0');
  });

  const presented: string[] = [];
  await page.route('**/api/v1/auth/refresh', (route) => {
    presented.push((route.request().postDataJSON() as { refresh_token: string }).refresh_token);
    return route.abort('failed');
  });

  await page.goto('/session');
  await expect.poll(() => presented.length).toBe(1);

  // Inside the pause before the retry.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in again' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(4_000);

  expect(
    presented.length,
    `one refresh token was presented ${presented.length} times: ${presented.join(', ')}`,
  ).toBeLessThanOrEqual(2);
});

/**
 * **A reload while the first request is still in flight.** The page that sent it is
 * gone and its answer with it, so the new page owes only the one retry: at most two
 * presentations, ending either in a session or in the halt.
 */
for (const retryAnswer of ['success', 'lost'] as const) {
  test(`a reload during the first request presents the token at most twice (retry ${retryAnswer})`, async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);

    let releaseFirst: () => void = () => {};
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const presented: string[] = [];
    await page.route('**/api/v1/auth/refresh', async (route) => {
      presented.push((route.request().postDataJSON() as { refresh_token: string }).refresh_token);
      if (presented.length === 1) {
        // Never answered to the page that sent it: the reload ends that page first.
        await firstHeld;
        await route.abort('failed').catch(() => {});
        return;
      }
      if (retryAnswer === 'success') {
        return route.fulfill(tokens('access-1', 'refresh-1'));
      }
      return route.abort('failed');
    });

    await page.goto('/people');
    await expect.poll(() => presented.length).toBe(1);

    await page.reload();

    if (retryAnswer === 'success') {
      await expect(
        page.getByText('Marilou Reyes Santos').filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(HALT_SENTENCE)).toHaveCount(0);
    } else {
      await expect(haltBanner(page)).toBeVisible({ timeout: 15_000 });
    }
    releaseFirst();
    await page.waitForTimeout(4_000);

    expect(
      presented,
      `one refresh token was presented ${presented.length} times: ${presented.join(', ')}`,
    ).toEqual(['test-refresh-token', 'test-refresh-token']);
  });
}

/**
 * **A record of two presentations already made halts without a request.** Whatever
 * page sent them, a third is the reuse signal.
 */
test('a stored record of the retry already sent halts with no request at all', async ({ page }) => {
  await mockSignedIn(page);
  await mockPeople(page);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'dfc.sent_token',
      JSON.stringify({ token: 'test-refresh-token', since: Date.now(), count: 2 }),
    );
  });

  let requested = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/auth/refresh')) {
      requested += 1;
    }
  });

  await page.goto('/people');
  await expect(haltBanner(page)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(4_000);
  expect(requested, 'a token recorded as already retried was presented again').toBe(0);
});

/**
 * **A first presentation recorded too long ago is past the retry window.** Section 6
 * serves the retry only within a window from the rotation (decision 0128), so the
 * client stops rather than send a retry the server would read as reuse.
 */
test('a stored first presentation older than the retry limit halts with no request', async ({
  page,
}) => {
  await mockSignedIn(page);
  await mockPeople(page);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'dfc.sent_token',
      JSON.stringify({ token: 'test-refresh-token', since: Date.now() - 60_000, count: 1 }),
    );
  });

  let requested = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/auth/refresh')) {
      requested += 1;
    }
  });

  await page.goto('/people');
  await expect(haltBanner(page)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(4_000);
  expect(requested, 'a retry was sent after its window had closed').toBe(0);
});

/**
 * **A stored first presentation inside the window is owed exactly its one retry**,
 * and a retry that succeeds leaves no record behind.
 */
test('a stored first presentation within the limit gets exactly one retry, then no record', async ({
  page,
}) => {
  await mockSignedIn(page);
  await mockPeople(page);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'dfc.sent_token',
      JSON.stringify({ token: 'test-refresh-token', since: Date.now(), count: 1 }),
    );
  });

  const presented: string[] = [];
  await page.route('**/api/v1/auth/refresh', (route) => {
    presented.push((route.request().postDataJSON() as { refresh_token: string }).refresh_token);
    return route.fulfill(tokens('access-1', 'refresh-1'));
  });

  await page.goto('/people');
  await expect(
    page.getByText('Marilou Reyes Santos').filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2_000);

  expect(presented).toEqual(['test-refresh-token']);
  const stored = await page.evaluate(() => ({
    refresh: window.localStorage.getItem('dfc.refresh_token'),
    sent: window.localStorage.getItem('dfc.sent_token'),
  }));
  expect(stored).toEqual({ refresh: 'refresh-1', sent: null });
});

/** An ordinary refresh that is answered leaves no record of having been sent. */
test('a refresh answered first time leaves no sent record', async ({ page }) => {
  await mockSignedIn(page);
  await mockPeople(page);

  await page.goto('/people');
  await expect(
    page.getByText('Marilou Reyes Santos').filter({ visible: true }).first(),
  ).toBeVisible();

  const sent = await page.evaluate(() => window.localStorage.getItem('dfc.sent_token'));
  expect(sent, 'a successful refresh left a sent record behind').toBeNull();
});

/**
 * **A second tab opened during the pause before the retry.** The first tab holds the
 * session lock through the pause, so the second waits for it and then finds the halt
 * (or the replacement) rather than sending a retry of its own beside the first tab's.
 */
test('a second tab opened during the pause does not add a presentation', async ({ context }) => {
  await context.addInitScript(() => {
    if (window.localStorage.getItem('dfc.refresh_token') === null) {
      window.localStorage.setItem('dfc.refresh_token', 'refresh-0');
    }
  });

  const presented: string[] = [];
  await context.route('**/api/v1/auth/refresh', (route) => {
    presented.push((route.request().postDataJSON() as { refresh_token: string }).refresh_token);
    return route.abort('failed');
  });

  const first = await context.newPage();
  await first.goto('/session');
  await expect.poll(() => presented.length).toBe(1);

  const second = await context.newPage();
  await second.goto('/session');
  await expect(first.getByRole('button', { name: 'Sign in again' })).toBeVisible({ timeout: 15_000 });
  await expect(second.getByRole('button', { name: 'Sign in again' })).toBeVisible({ timeout: 15_000 });
  await first.waitForTimeout(4_000);

  expect(presented, `presented ${presented.length} times`).toEqual(['refresh-0', 'refresh-0']);
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
  await expect(first.getByRole('button', { name: 'Sign in again' })).toBeVisible({ timeout: 15_000 });

  const second = await context.newPage();
  await second.goto('/session');
  await expect(second.getByRole('button', { name: 'Sign in again' })).toBeVisible();

  expect(presented, 'a second tab re-presented a halted token').toEqual(['refresh-0', 'refresh-0']);
});

/**
 * **A lost answer followed by a retry that succeeds is no interruption at all.** The
 * screen loads its data, nothing is said about a dropped connection, and the token
 * was presented exactly twice.
 */
test('a refresh lost in transit is retried once and the session carries on', async ({ page }) => {
  await mockSignedIn(page);
  await mockPeople(page);

  const presented: string[] = [];
  await page.route('**/api/v1/auth/refresh', (route) => {
    presented.push((route.request().postDataJSON() as { refresh_token: string }).refresh_token);
    return presented.length === 1
      ? route.abort('failed')
      : route.fulfill(tokens('access-1', 'refresh-1'));
  });

  await page.goto('/people');
  await expect(
    page.getByText('Marilou Reyes Santos').filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(HALT_SENTENCE)).toHaveCount(0);

  expect(presented).toEqual(['test-refresh-token', 'test-refresh-token']);
  const stored = await page.evaluate(() => window.localStorage.getItem('dfc.refresh_token'));
  expect(stored, 'the replacement the retry was given was not adopted').toBe('refresh-1');
  const sent = await page.evaluate(() => window.localStorage.getItem('dfc.sent_token'));
  expect(sent, 'a successful retry left a sent record behind').toBeNull();
});

/**
 * **When the retry has no answer either, every screen says so and nothing presents
 * the token again.** Not a later refetch, not an in-app navigation, not a full page
 * load. The one way on is signing in again, which forgets the token without
 * presenting it.
 */
test('a halted session shows the banner, never presents the token a third time, and signs in afresh', async ({
  page,
}) => {
  await mockSignedIn(page);
  await mockPeople(page);

  const presented: string[] = [];
  await page.route('**/api/v1/auth/refresh', (route) => {
    presented.push((route.request().postDataJSON() as { refresh_token: string }).refresh_token);
    return route.abort('failed');
  });

  await page.goto('/people');

  const banner = haltBanner(page);
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner.getByRole('button', { name: 'Sign in again' })).toBeVisible();
  expect(presented).toEqual(['test-refresh-token', 'test-refresh-token']);

  // Time for any query retry, then an in-app navigation, then a full page load.
  await page.waitForTimeout(4_000);
  await page.getByRole('link', { name: 'Cells' }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/cells$/);
  await expect(banner).toBeVisible();
  await page.waitForTimeout(2_000);
  await page.goto('/people');
  await expect(banner).toBeVisible();
  await page.waitForTimeout(4_000);

  expect(presented, 'a halted token was presented a third time').toEqual([
    'test-refresh-token',
    'test-refresh-token',
  ]);

  await banner.getByRole('button', { name: 'Sign in again' }).click();
  await page.waitForURL('**/sign-in');

  const stored = await page.evaluate(() => ({
    refresh: window.localStorage.getItem('dfc.refresh_token'),
    halted: window.localStorage.getItem('dfc.halted_token'),
  }));
  expect(stored, 'signing in again kept the old token').toEqual({ refresh: null, halted: null });
  expect(presented, 'signing in again presented the token').toHaveLength(2);
});

/**
 * **Offline, the retry waits for the connection rather than for the pause.** A
 * retry sent while the device still reports no connection fails for certain, and
 * spends the one re-presentation section 6 serves on nothing.
 */
test('offline, the one retry waits for the connection and then succeeds', async ({
  page,
  context,
}) => {
  await mockSignedIn(page);
  await mockPeople(page);

  // Counted from the page's own requests as well as the route, because a request
  // made while offline may be failed before any route sees it.
  let requested = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/auth/refresh')) {
      requested += 1;
    }
  });

  const presented: string[] = [];
  await page.route('**/api/v1/auth/refresh', async (route) => {
    presented.push((route.request().postDataJSON() as { refresh_token: string }).refresh_token);
    if (presented.length === 1) {
      // The device goes offline before the failure reaches the page, as it does
      // when the connection is what failed.
      await context.setOffline(true);
      return route.abort('internetdisconnected');
    }
    return route.fulfill(tokens('access-1', 'refresh-1'));
  });

  await page.goto('/people');
  await expect.poll(() => presented.length).toBe(1);

  // Longer than the online pause: nothing is sent while the device is offline.
  await page.waitForTimeout(5_000);
  expect(requested, 'a retry was sent while the device was offline').toBe(1);
  expect(presented).toHaveLength(1);

  await context.setOffline(false);

  await expect(
    page.getByText('Marilou Reyes Santos').filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(HALT_SENTENCE)).toHaveCount(0);
  expect(presented).toEqual(['test-refresh-token', 'test-refresh-token']);
  expect(requested).toBe(2);
});

/**
 * **A retry the server refuses ends the session rather than halting it.** A 401 or
 * `VALIDATION_FAILED` is a known outcome: the token is spent or malformed, and
 * keeping it would mean presenting it again.
 */
for (const refusal of [
  { status: 401, code: 'UNAUTHENTICATED', message: 'Refresh token is not valid.' },
  { status: 400, code: 'VALIDATION_FAILED', message: 'The request is not valid.' },
]) {
  test(`a retry refused with ${refusal.code} forgets the session and asks for a sign-in`, async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);

    const presented: string[] = [];
    await page.route('**/api/v1/auth/refresh', (route) => {
      presented.push((route.request().postDataJSON() as { refresh_token: string }).refresh_token);
      if (presented.length === 1) {
        return route.abort('failed');
      }
      return route.fulfill({
        status: refusal.status,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: refusal.code, message: refusal.message, details: {} },
        }),
      });
    });

    await page.goto('/people');
    await page.waitForURL('**/sign-in', { timeout: 15_000 });

    await expect(page.getByText(HALT_SENTENCE)).toHaveCount(0);
    const stored = await page.evaluate(() => ({
      refresh: window.localStorage.getItem('dfc.refresh_token'),
      halted: window.localStorage.getItem('dfc.halted_token'),
    }));
    expect(stored).toEqual({ refresh: null, halted: null });
    expect(presented).toHaveLength(2);
  });
}

/**
 * **A retry answered with anything else halts.** A 5xx or a rate limit refused the
 * attempt without saying what became of the token, so it is kept and never presented
 * again.
 */
for (const answer of [
  { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong.' },
  { status: 429, code: 'RATE_LIMITED', message: 'Too many requests.' },
]) {
  test(`a retry answered ${answer.status} halts, and the token is not presented again`, async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);

    const presented: string[] = [];
    await page.route('**/api/v1/auth/refresh', (route) => {
      presented.push((route.request().postDataJSON() as { refresh_token: string }).refresh_token);
      if (presented.length === 1) {
        return route.abort('failed');
      }
      return route.fulfill({
        status: answer.status,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: answer.code, message: answer.message, details: {} },
        }),
      });
    });

    await page.goto('/people');
    await expect(haltBanner(page)).toBeVisible({ timeout: 15_000 });

    // The query layer retries a 5xx; that must reach the halt, not the network.
    await page.waitForTimeout(4_000);
    expect(presented).toHaveLength(2);
    const stored = await page.evaluate(() => window.localStorage.getItem('dfc.refresh_token'));
    expect(stored).toBe('test-refresh-token');
  });
}

/**
 * `/session` says the same beside its own button, so the banner is not repeated
 * there, and the button does what the banner's does.
 */
test('the Account page, halted, offers Sign in again and nothing that presents the token', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('dfc.refresh_token', 'refresh-0');
  });

  const presented: string[] = [];
  await page.route('**/api/v1/auth/refresh', (route) => {
    presented.push((route.request().postDataJSON() as { refresh_token: string }).refresh_token);
    return route.abort('failed');
  });

  await page.goto('/session');
  const button = page.getByRole('button', { name: 'Sign in again' });
  await expect(button).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Try again anyway' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  // One copy of the sentence, not a banner repeating it.
  await expect(page.getByRole('button', { name: 'Sign in again' })).toHaveCount(1);

  await button.click();
  await page.waitForURL('**/sign-in');
  const stored = await page.evaluate(() => window.localStorage.getItem('dfc.refresh_token'));
  expect(stored).toBeNull();
  expect(presented).toHaveLength(2);
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

/**
 * **A cache must not outlive the session that filled it.**
 *
 * Every query key in this application names what it asks for and never who is
 * asking, and nothing cleared the cache when a session ended. So signing out and
 * signing in as somebody else served the previous person's answers until each key
 * passed its thirty-second `staleTime`: the dashboard greeted the wrong person by
 * name and linked to their pastoral network.
 *
 * The API was never wrong, which is why nothing else caught it. Every request
 * carried the new token and `/auth/me` answered with the new person throughout.
 * What was wrong is that the screen showed what the API had already stopped
 * saying — and section 7 decides what a person may see, so a Cell Leader signing
 * in after a Senior Pastor on a shared phone is shown figures the API refuses
 * them.
 *
 * Found by using the application rather than by a test, which is the honest note
 * to leave: two accounts each behave correctly in isolation, and no assertion
 * covered what one leaves behind for the next.
 */
test('a sign-out forgets what the previous session cached', async ({ page }) => {
  let whoAmI = 'Geraldine';

  await page.addInitScript(() => {
    window.localStorage.setItem('dfc.refresh_token', 'test-refresh-token');
  });

  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill(tokens('access-1', 'refresh-1')));
  await page.route('**/api/v1/auth/logout-all', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/auth/login', (route) => route.fulfill(tokens('access-2', 'refresh-2')));

  // The one thing that differs between the two people.
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        account_id: '4f8c1d6a-0f1e-4b2a-9c3d-5e6f7a8b9c0d',
        person_id: '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9',
        email: 'someone@example.invalid',
        first_name: whoAmI,
        roles: ['LEADER'],
        capabilities: [],
      }),
    }),
  );

  // **One page load, and then nothing but in-app navigation.** That is the whole
  // of the case: a reload always corrected this, because the client is created
  // per mount, so a test that called `goto` between the two sessions would pass
  // with the fix removed. It did, before this was rewritten.
  await page.goto('/session');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Account and session');

  await page.getByRole('button', { name: /^Sign out on every device/ }).click();
  await page.getByRole('button', { name: 'Yes, sign out everywhere' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sign in');

  whoAmI = 'Oriel';
  await page.getByLabel('Email address').fill('oriel@example.invalid');
  await page.getByLabel('Password').fill('a-password-nobody-uses');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Oriel');
  await expect(page.getByRole('heading', { level: 1 })).not.toContainText('Geraldine');
});

test('names the role the server honours, and asks before ending every other session', async ({
  page,
}) => {
  await mockSignedIn(page);

  let endedEverywhere = 0;
  await page.route('**/api/v1/auth/logout-all', (route) => {
    endedEverywhere += 1;

    return route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/session');

  // Decision 0263: said by the server, never worked out from the capabilities.
  await expect(page.getByRole('term').filter({ hasText: 'Role' })).toBeVisible();
  await expect(page.getByText('Leader', { exact: true })).toBeVisible();

  // The question comes first, and nothing has happened while it stands.
  await page.getByRole('button', { name: /^Sign out on every device/ }).click();
  await expect(page.getByText(/including any phone you are not holding/)).toBeVisible();
  expect(endedEverywhere).toBe(0);

  // A second click on the trigger cannot reach the confirmation: it re-opens the panel
  // that is already open, which is why the confirmation renders below the trigger rather
  // than in its slot.
  await page.getByRole('button', { name: /^Sign out on every device/ }).dblclick();
  expect(endedEverywhere).toBe(0);

  await page.getByRole('button', { name: 'Keep them' }).click();
  await expect(page.getByRole('button', { name: 'Yes, sign out everywhere' })).toBeHidden();
  expect(endedEverywhere).toBe(0);

  // And the confirmation does what it says, which the first version of this case never
  // asserted — it pinned the guard and left the guarded action untested.
  await page.getByRole('button', { name: /^Sign out on every device/ }).click();
  await page.getByRole('button', { name: 'Yes, sign out everywhere' }).click();
  await expect.poll(() => endedEverywhere).toBe(1);
});
