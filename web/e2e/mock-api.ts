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
        first_name: 'Marilou',
        capabilities: CAPABILITIES,
      }),
    ),
  );
}

/**
 * A person the viewer pastors, and one they do not.
 *
 * Both shapes are here deliberately: section 8's redaction is the thing the
 * search screen has to render correctly, and a fixture with only full profiles
 * would scan a screen nobody will see.
 */
export const PERSON_IN_SCOPE = {
  scope: 'FULL',
  id: '11111111-2222-4333-8444-555555555555',
  member_id: 'M-000042',
  first_name: 'Marilou',
  middle_name: 'Reyes',
  last_name: 'Santos',
  full_name: 'Marilou Reyes Santos',
  birth_date: '1988-04-17',
  sex: 'FEMALE',
  civil_status: 'MARRIED',
  mobile_number: '0917 555 0142',
};

export const PERSON_WITHHELD = {
  scope: 'IDENTITY_ONLY',
  id: '66666666-7777-4888-8999-000000000000',
  member_id: 'M-000108',
  full_name: 'Teresa Aquino Lim',
  sex: 'FEMALE',
  network: 'WOMENS',
  direct_leader_name: 'Corazon Batac',
};

/** The people endpoints, for the screens that read them. */
export async function mockPeople(page: Page): Promise<void> {
  // Registered before the search route, because Playwright matches the most
  // recently added first and `/people?*` would otherwise swallow this.
  await page.route('**/api/v1/people/duplicate-candidates*', (route) =>
    route.fulfill(json({ data: [] })),
  );

  await page.route('**/api/v1/people?*', (route) =>
    route.fulfill(json({ data: [PERSON_IN_SCOPE, PERSON_WITHHELD], next_cursor: null })),
  );

  await page.route(`**/api/v1/people/${PERSON_IN_SCOPE.id}`, (route) =>
    route.fulfill(json(PERSON_IN_SCOPE)),
  );
}

/**
 * The pre-flight lookup with something to show — a Tier 2 candidate the viewer
 * pastors, and one whose details section 8 withholds.
 *
 * The withheld one carries `possible_match` and no tier, which is what the API
 * sends. A fixture that omitted it would let the client's inference-from-shape
 * pass unnoticed, which is the drift this file claims not to permit.
 */
export async function mockPossibleMatches(page: Page): Promise<void> {
  await page.route('**/api/v1/people/duplicate-candidates*', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: PERSON_IN_SCOPE.id,
            member_id: PERSON_IN_SCOPE.member_id,
            full_name: PERSON_IN_SCOPE.full_name,
            sex: PERSON_IN_SCOPE.sex,
            tier: 2,
            reasons: ['Same first and last name'],
          },
          {
            id: PERSON_WITHHELD.id,
            member_id: PERSON_WITHHELD.member_id,
            full_name: PERSON_WITHHELD.full_name,
            sex: PERSON_WITHHELD.sex,
            possible_match: true,
          },
          {
            // **`possible_match` *with* a tier**, which the API does not send —
            // and that is the point. Both other fixtures carry the flag and no
            // tier, so `isWithheld` answers the same whether it reads the flag
            // or falls back to the missing tier, and the fix for reading the
            // flag is pinned by nothing. This one separates them: it must be
            // treated as withheld, which only the flag can decide.
            id: '22222222-3333-4444-8555-666666666666',
            member_id: 'M-000207',
            full_name: 'Zenaida Cruz Ocampo',
            sex: 'FEMALE',
            possible_match: true,
            tier: 2,
          },
        ],
      }),
    ),
  );
}

/**
 * Creation refused because a Tier 1 candidate needs acknowledging (section 3).
 *
 * One candidate carries reasons and one does not — the second is outside the
 * viewer's scope, where section 8 withholds the tier and the reasons both,
 * because either would answer a question about a birthday.
 */
export async function mockDuplicateRefusal(page: Page): Promise<void> {
  await page.route('**/api/v1/people', (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }

    return route.fulfill(
      json(
        {
          error: {
            code: 'DUPLICATE_ACKNOWLEDGEMENT_REQUIRED',
            message:
              'This may be someone already recorded. Review the candidates, then resubmit acknowledging them.',
            details: {
              candidates: [
                {
                  id: PERSON_IN_SCOPE.id,
                  member_id: PERSON_IN_SCOPE.member_id,
                  full_name: PERSON_IN_SCOPE.full_name,
                  tier: 1,
                  reasons: ['Same first and last name', 'Same birthday'],
                },
                {
                  id: PERSON_WITHHELD.id,
                  member_id: PERSON_WITHHELD.member_id,
                  full_name: PERSON_WITHHELD.full_name,
                  sex: PERSON_WITHHELD.sex,
                  // The API's own flag for a withheld candidate. Present here so
                  // that a client inferring the same fact from a missing tier
                  // does not pass the harness unnoticed.
                  possible_match: true,
                },
              ],
            },
          },
        },
        409,
      ),
    );
  });
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
