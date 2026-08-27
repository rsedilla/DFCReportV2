import type { Page } from '@playwright/test';

/**
 * The API, as far as the accessibility sweep is concerned.
 *
 * Every response here is shaped like the real one — SKILL.md section 22's single
 * error envelope, and `GET /auth/me`'s grant list as `api/src/auth/auth.service.ts`
 * builds it. That matters because the sweep is checking rendered output, and a
 * screen rendered from a payload of the wrong shape is not the screen anybody
 * will see.
 *
 * It is a stand-in for the *transport*, not for the rules. Nothing here decides
 * anything: the fixtures are the answers the API would give, chosen to reach the
 * states worth scanning.
 */

const SESSION_TOKENS = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  token_type: 'Bearer',
  expires_in: 900,
};

/**
 * A grant list with enough variety to render every branch of the table: a
 * Whole Church write, a subtree write, and a read-only read.
 */
const CAPABILITIES = [
  {
    capability: 'people.create',
    scope_type: 'WHOLE_CHURCH',
    scope_network: null,
    read_only: false,
    source: 'ROLE',
  },
  {
    capability: 'people.edit_basic',
    scope_type: 'OWN_SUBTREE',
    scope_network: null,
    read_only: false,
    source: 'ROLE',
  },
  {
    capability: 'reports.view_subtree',
    scope_type: 'NETWORK',
    scope_network: 'MENS',
    read_only: true,
    source: 'GRANT',
  },
];

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

function apiError(status: number, code: string, message: string) {
  return json({ error: { code, message, details: {} } }, status);
}

/** Install the happy path: a live session, and `/auth/me` answering for it. */
export async function mockSignedIn(page: Page): Promise<void> {
  // Written before any script on the page runs, so the client finds a stored
  // refresh token exactly as it would after a real sign-in on this device.
  await page.addInitScript(() => {
    window.localStorage.setItem('dfc.refresh_token', 'test-refresh-token');
  });

  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill(json(SESSION_TOKENS)));

  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill(
      json({
        account_id: '4f8c1d6a-0f1e-4b2a-9c3d-5e6f7a8b9c0d',
        person_id: '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9',
        email: 'admin@example.invalid',
        capabilities: CAPABILITIES,
      }),
    ),
  );
}

/** A sign-in that is refused, for scanning the form-level error state. */
export async function mockSignInRefused(page: Page): Promise<void> {
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill(apiError(401, 'UNAUTHENTICATED', 'Those credentials do not match an account.')),
  );
}

/** A request that succeeds with no body, as the 204 endpoints do. */
export async function mockAccepted(page: Page, pattern: string): Promise<void> {
  await page.route(pattern, (route) => route.fulfill({ status: 204, body: '' }));
}
