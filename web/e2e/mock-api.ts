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

const ME = {
  account_id: '4f8c1d6a-0f1e-4b2a-9c3d-5e6f7a8b9c0d',
  person_id: '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9',
  email: 'admin@example.invalid',
  first_name: 'Marilou',
  roles: ['LEADER'],
  capabilities: CAPABILITIES,
};

/** Install the happy path: a live session, and `/auth/me` answering for it. */
export async function mockSignedIn(page: Page): Promise<void> {
  // Written before any script on the page runs, so the client finds a stored
  // refresh token exactly as it would after a real sign-in on this device.
  await page.addInitScript(() => {
    window.localStorage.setItem('dfc.refresh_token', 'test-refresh-token');
  });

  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill(json(SESSION_TOKENS)));

  await page.route('**/api/v1/auth/me', (route) => route.fulfill(json(ME)));
}

/**
 * The same account, reading reports across the whole church.
 *
 * **Installed after `mockSignedIn`, and overrides it for `/auth/me` alone**, because
 * Playwright runs the most recently registered matching route first. The shared grant
 * list reads reports over one Network, so without this the arrangement decision 0245
 * gives a whole-church reader is reachable by no test at all. Only the reporting
 * grant is widened, so a case using it differs from the rest in that one respect.
 */
export async function mockWholeChurchReader(page: Page): Promise<void> {
  const capabilities = CAPABILITIES.map((grant) =>
    grant.capability === 'reports.view_subtree'
      ? { ...grant, scope_type: 'WHOLE_CHURCH', scope_network: null }
      : grant,
  );

  await page.route('**/api/v1/auth/me', (route) => route.fulfill(json({ ...ME, capabilities })));
}

/** The same account without `people.edit_basic`, overriding `/auth/me` alone as above. */
export async function mockWithoutEditBasic(page: Page): Promise<void> {
  const capabilities = CAPABILITIES.filter((grant) => grant.capability !== 'people.edit_basic');

  await page.route('**/api/v1/auth/me', (route) => route.fulfill(json({ ...ME, capabilities })));
}

/** The shared account's person, for a case about viewing your own record. */
export const SIGNED_IN_PERSON_ID = ME.person_id;

/**
 * The same account, also holding the capabilities named, each over its own subtree.
 *
 * **Installed after `mockSignedIn`, and overrides it for `/auth/me` alone**, as the two
 * below do. The shared grant list holds neither `people.manage_pastoral_assignment` nor
 * `dcc.correct_subtree`, so the controls those capabilities offer are reachable only here.
 */
export async function mockGrants(page: Page, extra: readonly string[]): Promise<void> {
  const capabilities = [
    ...CAPABILITIES,
    ...extra.map((capability) => ({
      capability,
      scope_type: 'OWN_SUBTREE',
      scope_network: null,
      read_only: false,
      source: 'ROLE',
    })),
  ];

  await page.route('**/api/v1/auth/me', (route) => route.fulfill(json({ ...ME, capabilities })));
}

/**
 * The same account, also allowed to correct a recorded Cell meeting.
 *
 * **Installed after `mockSignedIn`, and overrides it for `/auth/me` alone**, as above.
 * The shared grant list holds no Cell capability, which is the account a recording
 * screen shows a recorded meeting to read-only (decision 0246); this adds
 * `cell.correct_subtree` so the other side of that screen's gate is reachable too.
 */
export async function mockCellCorrector(page: Page): Promise<void> {
  const capabilities = [
    ...CAPABILITIES,
    {
      capability: 'cell.correct_subtree',
      scope_type: 'OWN_SUBTREE',
      scope_network: null,
      read_only: false,
      source: 'ROLE',
    },
  ];

  await page.route('**/api/v1/auth/me', (route) => route.fulfill(json({ ...ME, capabilities })));
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
  title: null,
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

/** The leader of the Cell `PERSON_IN_SCOPE` belongs to. */
const CELL_LEADER = {
  person_id: '22222222-3333-4444-8555-666666666666',
  member_id: 'M-000017',
  full_name: 'Corazon Batac',
};

/**
 * The Cells of the viewer's scope, for the Cell pickers on Add and in the Move dialog.
 * The first is the Cell `PERSON_IN_SCOPE` already belongs to.
 */
export const CELL_CHOICES = [
  { id: '3f1b7c6e-0000-4000-8000-000000000101', cell_id: 'CELL-000007', category: 'YOUTH', leader: CELL_LEADER },
  {
    id: '3f1b7c6e-0000-4000-8000-000000000102',
    cell_id: 'CELL-000011',
    category: 'YOUNG_PRO',
    leader: {
      person_id: '33333333-4444-4555-8666-777777777777',
      member_id: 'M-000023',
      full_name: 'Liza Mendoza',
    },
  },
  {
    id: '3f1b7c6e-0000-4000-8000-000000000103',
    cell_id: 'CELL-000014',
    category: 'COUPLE',
    leader: {
      person_id: '44444444-5555-4666-8777-888888888888',
      member_id: 'M-000031',
      full_name: 'Teresita Ramos',
    },
  },
].map((cell) => ({
  ...cell,
  // `PERSON_IN_SCOPE`'s own Network, so a picker narrowing to it keeps all three.
  network: 'WOMENS',
  schedule: { day_of_week: 6, time_of_day: '19:00' },
  coverage: { recorded: 3, scheduled: 4, behind: 1 },
}));

/**
 * `PERSON_IN_SCOPE`'s DCC records (decision 0247), newest first over two pages: two
 * years on the first, one of them a Sunday later removed, and an older year behind the
 * cursor.
 */
export const DCC_PAGE_ONE = {
  person_id: PERSON_IN_SCOPE.id,
  classification: 'REGULAR',
  attended: 6,
  data: [
    { event_id: '5a000000-0000-4000-8000-000000000001', event_date: '2026-09-13', present: true, removed: false },
    { event_id: '5a000000-0000-4000-8000-000000000002', event_date: '2026-09-06', present: false, removed: false },
    { event_id: '5a000000-0000-4000-8000-000000000003', event_date: '2026-08-30', present: true, removed: true },
    { event_id: '5a000000-0000-4000-8000-000000000004', event_date: '2026-08-23', present: true, removed: false },
    { event_id: '5a000000-0000-4000-8000-000000000005', event_date: '2025-12-28', present: true, removed: false },
    { event_id: '5a000000-0000-4000-8000-000000000006', event_date: '2025-12-21', present: true, removed: false },
  ],
  next_cursor: 'older-sundays',
};

export const DCC_PAGE_TWO = {
  ...DCC_PAGE_ONE,
  data: [
    { event_id: '5a000000-0000-4000-8000-000000000007', event_date: '2025-06-01', present: true, removed: false },
    { event_id: '5a000000-0000-4000-8000-000000000008', event_date: '2024-11-17', present: true, removed: false },
  ],
  next_cursor: null,
};

/** The people endpoints, for the screens that read them. */
export async function mockPeople(page: Page): Promise<void> {
  // Registered before the search route, because Playwright matches the most
  // recently added first and `/people?*` would otherwise swallow this.
  await page.route('**/api/v1/people/duplicate-candidates*', (route) =>
    route.fulfill(json({ data: [] })),
  );

  await page.route('**/api/v1/people?*', (route) =>
    route.fulfill(
      json({
        // A search row names the person's leader (owner's choice of 2026-09-19).
        data: [{ ...PERSON_IN_SCOPE, direct_leader_name: 'Teofilo Ramos' }, PERSON_WITHHELD],
        next_cursor: null,
      }),
    ),
  );

  await page.route(`**/api/v1/people/${PERSON_IN_SCOPE.id}`, (route) =>
    route.fulfill(json(PERSON_IN_SCOPE)),
  );

  // The profile's Cell and DCC sections (decisions 0248 and 0247).
  await mockPersonCells(page, {
    membership: {
      id: CELL_CHOICES[0].id,
      cell_id: 'CELL-000007',
      category: 'YOUTH',
      day_of_week: 6,
      leader: CELL_LEADER,
    },
    leads: [],
  });

  await page.route('**/api/v1/dcc/people/*/attendance*', (route) =>
    route.fulfill(json(route.request().url().includes('cursor=') ? DCC_PAGE_TWO : DCC_PAGE_ONE)),
  );
}

/** A person's Cell answer (decision 0248). Installed after `mockPeople`, it overrides it. */
export async function mockPersonCells(
  page: Page,
  answer: { membership: unknown; leads: { id: string; cell_id: string }[] },
): Promise<void> {
  await page.route('**/api/v1/cells/people/*/membership', (route) =>
    route.fulfill(json({ person_id: PERSON_IN_SCOPE.id, ...answer })),
  );
}

/** The DCC section refused to this account, with API wording no screen should show. */
export async function mockPersonDccRefused(page: Page): Promise<void> {
  await page.route('**/api/v1/dcc/people/*/attendance*', (route) =>
    route.fulfill(apiError(403, 'CAPABILITY_DENIED', 'You do not hold dcc.view_subtree.')),
  );
}

/** A Men's Network Cell, which a picker for `PERSON_IN_SCOPE` must not offer. */
export const MENS_CELL_CHOICE = {
  id: '3f1b7c6e-0000-4000-8000-000000000104',
  cell_id: 'CELL-000019',
  category: 'YOUTH',
  network: 'MENS',
  leader: {
    person_id: '55555555-6666-4777-8888-999999999999',
    member_id: 'M-000044',
    full_name: 'Ernesto Villanueva',
  },
  schedule: { day_of_week: 5, time_of_day: '19:30' },
  coverage: { recorded: 0, scheduled: 4, behind: 0 },
};

/** The Cells index, for the Cell pickers; `extra` adds rows after the three. */
export async function mockCellChoices(
  page: Page,
  extra: readonly unknown[] = [],
): Promise<void> {
  await page.route('**/api/v1/cells?*', (route) =>
    route.fulfill(
      json({
        reporting_month: '2026-09-01',
        open: true,
        data: [...CELL_CHOICES, ...extra],
        next_cursor: null,
      }),
    ),
  );
}

/**
 * `POST /cells/{id}/members`, accepted or refused by section 10's same-Network rule. The
 * refusal carries both Networks in `details`, as the API's own test pins. Returns every
 * request made, so a case can say what was sent.
 */
export async function mockMembershipAdd(
  page: Page,
  outcome: 'accepted' | 'other-network',
): Promise<{ path: string; body: unknown }[]> {
  const sent: { path: string; body: unknown }[] = [];

  await page.route('**/api/v1/cells/*/members', (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }

    sent.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });

    return outcome === 'accepted'
      ? route.fulfill(json({ person_id: PERSON_IN_SCOPE.id }, 201))
      : route.fulfill(
          json(
            {
              error: {
                code: 'INVARIANT_VIOLATION',
                message:
                  'A Cell member and the Cell leader belong to the same Network (SKILL.md section 10, Managing Cell membership).',
                details: {
                  person_id: PERSON_IN_SCOPE.id,
                  member_network: 'WOMENS',
                  cell_network: 'MENS',
                },
              },
            },
            409,
          ),
        );
  });

  return sent;
}

/** `POST /people`, creating `PERSON_IN_SCOPE`. */
export async function mockPersonCreated(page: Page): Promise<void> {
  await page.route('**/api/v1/people', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill(json(PERSON_IN_SCOPE, 201))
      : route.fallback(),
  );
}

/**
 * Section 15's people-without-a-Cell list, with two people on it (decision 0233).
 *
 * Registered on the `cells` prefix, which is where the route lives: the list is a Cell
 * attention list even though every row names a Person.
 */
export async function mockPeopleWithoutACell(page: Page): Promise<void> {
  await page.route('**/api/v1/cells/people-without-a-cell*', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: '3f1b7c6e-0000-4000-8000-000000000921',
            member_id: 'M-001101',
            full_name: 'Bituin Carreon',
          },
          {
            id: '3f1b7c6e-0000-4000-8000-000000000922',
            member_id: 'M-001102',
            full_name: 'Rodolfo Villamor',
          },
        ],
        next_cursor: null,
      }),
    ),
  );
}

/**
 * The attention list section 20 requires (decision 0232), with something on it.
 *
 * Two rows rather than one, because the screen's own ordering rule is the thing most
 * worth not breaking: section 15 forbids ranking, so these are alphabetical by the
 * name shown and nothing else.
 */
export async function mockAwaitingReassignment(page: Page): Promise<void> {
  await page.route('**/api/v1/people/awaiting-reassignment*', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: '3f1b7c6e-0000-4000-8000-000000000901',
            member_id: 'M-001001',
            full_name: 'Amihan Bacani',
            former_leader: {
              person_id: '3f1b7c6e-0000-4000-8000-000000000903',
              member_id: 'M-001003',
              full_name: 'Rogelio Mendoza',
            },
          },
          {
            id: '3f1b7c6e-0000-4000-8000-000000000902',
            member_id: 'M-001002',
            full_name: 'Teodoro Cruz',
            former_leader: {
              person_id: '3f1b7c6e-0000-4000-8000-000000000903',
              member_id: 'M-001003',
              full_name: 'Rogelio Mendoza',
            },
          },
        ],
        next_cursor: null,
      }),
    ),
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
