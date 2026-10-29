import type { Locator, Page } from '@playwright/test';

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
  // Today's screens, which every suite written before decision 0323 exercises.
  screens: 'FULL',
  people_i_oversee: true,
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

/** `conquest.view_subtree` at Whole Church, which the Admin and Senior Pastor roles hold. */
const CONQUEST_WHOLE_CHURCH = {
  capability: 'conquest.view_subtree',
  scope_type: 'WHOLE_CHURCH',
  scope_network: null,
  read_only: false,
  source: 'ROLE',
};

/**
 * The same account, reading reports across the whole church.
 *
 * **Installed after `mockSignedIn`, and overrides it for `/auth/me` alone**, because
 * Playwright runs the most recently registered matching route first. The shared grant
 * list reads reports over one Network, so without this the arrangement decision 0245
 * gives a whole-church reader is reachable by no test at all. The reporting grant is widened,
 * and Conquest is held at Whole Church as the Admin holds it (decision 0407), so a case using it
 * stands for the Admin's screens; its role is still the shared Leader's.
 */
export async function mockWholeChurchReader(page: Page): Promise<void> {
  const capabilities = [
    ...CAPABILITIES.map((grant) =>
      grant.capability === 'reports.view_subtree'
        ? { ...grant, scope_type: 'WHOLE_CHURCH', scope_network: null }
        : grant,
    ),
    // As the Admin holds it, which draws the Conquest item (decision 0407).
    CONQUEST_WHOLE_CHURCH,
  ];

  await page.route('**/api/v1/auth/me', (route) => route.fulfill(json({ ...ME, capabilities })));
}

/**
 * The same account reading people across the whole church, as the Admin and the Senior Pastors
 * do, whose pickers ask for the church-wide directory (decision 0389). Only that grant is widened.
 */
export async function mockWholeChurchPeopleReader(page: Page): Promise<void> {
  const capabilities = [
    ...CAPABILITIES,
    {
      capability: 'people.view_subtree',
      scope_type: 'WHOLE_CHURCH',
      scope_network: null,
      read_only: false,
      source: 'ROLE',
    },
  ];

  await page.route('**/api/v1/auth/me', (route) => route.fulfill(json({ ...ME, capabilities })));
}

/** The same account without `people.edit_basic`, overriding `/auth/me` alone as above. */
export async function mockWithoutEditBasic(page: Page): Promise<void> {
  const capabilities = CAPABILITIES.filter((grant) => grant.capability !== 'people.edit_basic');

  await page.route('**/api/v1/auth/me', (route) => route.fulfill(json({ ...ME, capabilities })));
}

/**
 * The same account as an administrator: `settings.manage` and `suynl.view_subtree` at Whole
 * Church, as section 7 gives the Admin role, overriding `/auth/me` alone as above. The
 * Encounter seasons screens offer their controls to that grant and to nothing narrower
 * (decision 0296).
 */
export async function mockAdministrator(page: Page): Promise<void> {
  const wholeChurch = (capability: string) => ({
    capability,
    scope_type: 'WHOLE_CHURCH',
    scope_network: null,
    read_only: false,
    source: 'ROLE',
  });
  // Reports at Whole Church too, as the role gives them, so the Admin is no Full view leader
  // and keeps every Growth tab (decision 0360).
  const capabilities = [
    ...CAPABILITIES.map((grant) =>
      grant.capability === 'reports.view_subtree' ? wholeChurch(grant.capability) : grant,
    ),
    wholeChurch('settings.manage'),
    wholeChurch('suynl.view_subtree'),
    // A title is the Admin's alone to give (decision 0374).
    wholeChurch('people.set_title'),
    // Conquest, which draws its sidebar item (decision 0407).
    wholeChurch('conquest.view_subtree'),
  ];

  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill(json({ ...ME, roles: ['ADMIN'], capabilities })),
  );
}

/**
 * The administrator above, also holding `cell.approve_leadership` at Whole Church as the role
 * does: the one account New Cell is offered to (sections 2 and 10, decision 0379). Separate from
 * `mockAdministrator` so that no other case meets the approval queue it brings.
 */
export async function mockCellCreator(page: Page): Promise<void> {
  const wholeChurch = (capability: string) => ({
    capability,
    scope_type: 'WHOLE_CHURCH',
    scope_network: null,
    read_only: false,
    source: 'ROLE',
  });
  const capabilities = [
    ...CAPABILITIES.map((grant) =>
      grant.capability === 'reports.view_subtree' ? wholeChurch(grant.capability) : grant,
    ),
    wholeChurch('cell.approve_leadership'),
    // As the Admin role holds it, so the sidebar is the Admin's (decision 0407).
    wholeChurch('conquest.view_subtree'),
  ];

  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill(json({ ...ME, roles: ['ADMIN'], capabilities })),
  );
}

/**
 * The same account on the screens the server names other than today's (decision 0323,
 * point 5), overriding `/auth/me` alone as above.
 *
 * `RECORDING` is a Leader without Full view: it holds no `reports.view_subtree` (point 2), and
 * `peopleIOversee` is the server's answer for whether a leader with an account sits directly
 * beneath it. `SENIOR_PASTOR` reads reports at Whole Church, as section 7 gives the role, and
 * is never offered Leaders Under Me (decision 0325, point 1).
 */
export async function mockScreens(
  page: Page,
  screens: 'RECORDING' | 'SENIOR_PASTOR',
  {
    peopleIOversee = false,
    wholeChurch = [],
  }: {
    peopleIOversee?: boolean;
    /** Further capabilities held at Whole Church, as the Senior Pastor role holds the Growth reads. */
    wholeChurch?: readonly string[];
  } = {},
): Promise<void> {
  const extra = wholeChurch.map((capability) => ({
    capability,
    scope_type: 'WHOLE_CHURCH',
    scope_network: null,
    read_only: false,
    source: 'ROLE',
  }));
  const capabilities = [
    ...(screens === 'RECORDING'
      ? CAPABILITIES.filter((grant) => grant.capability !== 'reports.view_subtree')
      : CAPABILITIES
          // A Senior Pastor holds no `people.create` and no `people.edit_basic` (decision 0326).
          .filter(
            (grant) =>
              grant.capability !== 'people.create' && grant.capability !== 'people.edit_basic',
          )
          .map((grant) =>
            grant.capability === 'reports.view_subtree'
              ? { ...grant, scope_type: 'WHOLE_CHURCH', scope_network: null, source: 'ROLE' }
              : grant,
          )),
    // The Senior Pastor role holds Conquest at Whole Church (decision 0407).
    ...(screens === 'SENIOR_PASTOR' ? [CONQUEST_WHOLE_CHURCH] : []),
    ...extra,
  ];

  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill(
      json({
        ...ME,
        roles: screens === 'SENIOR_PASTOR' ? ['SENIOR_PASTOR'] : ['LEADER'],
        screens,
        people_i_oversee: screens === 'RECORDING' && peopleIOversee,
        capabilities,
      }),
    ),
  );
}

/** The shared account's person, for a case about viewing your own record. */
export const SIGNED_IN_PERSON_ID = ME.person_id;

/**
 * The same account, also holding the capabilities named, each over its own subtree.
 *
 * **Installed after `mockSignedIn`, and overrides it for `/auth/me` alone**, as the two
 * below do. The shared grant list holds neither `people.manage_pastoral_assignment` nor
 * `dcc.correct_subtree`, so the controls those capabilities offer are reachable only here.
 * `wholeChurch` widens the reporting grant as `mockWholeChurchReader` does, for a case about
 * what a Full view leader is not shown (decision 0360); it adds no Conquest, which `conquest`
 * does (decision 0407).
 */
export async function mockGrants(
  page: Page,
  extra: readonly string[],
  {
    wholeChurch = false,
    conquest = false,
  }: {
    wholeChurch?: boolean;
    /** Also `conquest.view_subtree` at Whole Church, as the Admin holds it (decision 0407). */
    conquest?: boolean;
  } = {},
): Promise<void> {
  const capabilities = [
    ...CAPABILITIES.map((grant) =>
      wholeChurch && grant.capability === 'reports.view_subtree'
        ? { ...grant, scope_type: 'WHOLE_CHURCH', scope_network: null }
        : grant,
    ),
    ...extra.map((capability) => ({
      capability,
      scope_type: 'OWN_SUBTREE',
      scope_network: null,
      read_only: false,
      source: 'ROLE',
    })),
    ...(conquest ? [CONQUEST_WHOLE_CHURCH] : []),
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

/** Three people a new-Cell request may name as members (decision 0353). */
export const MEMBER_CHOICES = [
  { scope: 'IDENTITY_ONLY', id: '11111111-2222-4333-8444-000000000701', member_id: 'M-000701', full_name: 'Ana Dela Cruz', sex: 'FEMALE', network: 'WOMENS' },
  { scope: 'IDENTITY_ONLY', id: '11111111-2222-4333-8444-000000000702', member_id: 'M-000702', full_name: 'Bea Mendoza', sex: 'FEMALE', network: 'WOMENS' },
  { scope: 'IDENTITY_ONLY', id: '11111111-2222-4333-8444-000000000703', member_id: 'M-000703', full_name: 'Carla Navarro', sex: 'FEMALE', network: 'WOMENS' },
] as const;

/** What `chooseThreeMembers` types into each member picker. */
export const MEMBER_SEARCH_TERM = 'Members';

/**
 * The search the three member pickers make (decision 0353), answering `MEMBER_CHOICES`; any
 * other search falls through to the routes installed before it. It searches the searcher's own
 * people and never the church (decision 0369), so the URLs it was asked are returned for a test
 * to check.
 */
export async function mockMemberSearch(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route('**/api/v1/people?*', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') !== MEMBER_SEARCH_TERM) {
      return route.fallback();
    }
    asked.push(url.toString());
    return route.fulfill(json({ data: MEMBER_CHOICES, next_cursor: null }));
  });
  return asked;
}

/**
 * Chooses the three members in an open new-Cell or restart dialog, a different person in each
 * picker: only one picker shows results at a time, so its nth Choose is the nth person.
 */
export async function chooseThreeMembers(dialog: Locator): Promise<void> {
  for (const slot of [0, 1, 2]) {
    await dialog.getByLabel(`Search for member ${slot + 1} by name`).fill(MEMBER_SEARCH_TERM);
    // Earlier pickers have collapsed to their choice, so the first Search left is this one's.
    await dialog.getByRole('button', { name: 'Search people' }).first().click();
    await dialog.getByRole('button', { name: 'Choose', exact: true }).nth(slot).click();
  }
}

/** A person's Cell answer (decision 0248). Installed after `mockPeople`, it overrides it. */
export async function mockPersonCells(
  page: Page,
  answer: { membership: unknown; leads: { id: string; cell_id: string }[] },
): Promise<void> {
  await page.route('**/api/v1/cells/people/*/membership', (route) =>
    route.fulfill(json({ person_id: PERSON_IN_SCOPE.id, ...answer })),
  );
  // The People list asks for its whole page at once, and gets the same answer per person.
  await page.route('**/api/v1/cells/people/membership?*', (route) => {
    const asked = new URL(route.request().url()).searchParams.getAll('person_id');
    return route.fulfill(
      json({ data: asked.map((personId) => ({ person_id: personId, ...answer })) }),
    );
  });
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

/**
 * The Cells index, for the Cell pickers; `extra` adds rows after the three. A `q` narrows
 * to a leader's name or Cell ID containing it, as the index's search does (decision 0261).
 */
export async function mockCellChoices(
  page: Page,
  extra: readonly { cell_id: string; leader: { full_name: string } }[] = [],
): Promise<void> {
  await page.route('**/api/v1/cells?*', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q')?.toLowerCase() ?? null;
    const all: readonly { cell_id: string; leader: { full_name: string } }[] = [
      ...CELL_CHOICES,
      ...extra,
    ];

    return route.fulfill(
      json({
        reporting_month: '2026-09-01',
        open: true,
        data:
          q === null
            ? all
            : all.filter(
                (cell) =>
                  cell.leader.full_name.toLowerCase().includes(q) ||
                  cell.cell_id.toLowerCase().includes(q),
              ),
        next_cursor: null,
      }),
    );
  });
}

/** Searches a Cell picker (owner's choice, 2026-09-30) within `scope`. */
export async function searchCells(scope: Page | Locator, term: string): Promise<void> {
  await scope.getByLabel(/Search for a Cell Group|Or find another Cell Group/).fill(term);
  await scope.getByRole('button', { name: 'Search Cells' }).click();
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

/** The same account, also holding `cell.approve_leadership` at Whole Church, as Admin does. */
export async function mockCellApprover(page: Page): Promise<void> {
  const capabilities = [
    ...CAPABILITIES,
    {
      capability: 'cell.approve_leadership',
      scope_type: 'WHOLE_CHURCH',
      scope_network: null,
      read_only: false,
      source: 'ROLE',
    },
  ];

  await page.route('**/api/v1/auth/me', (route) => route.fulfill(json({ ...ME, capabilities })));
}

/**
 * The same account ticked *Approves Cells* (decision 0352): `cell.approve_leadership` over its
 * own branch, below itself, as a Full view leader is given it.
 */
export async function mockTickedApprover(page: Page): Promise<void> {
  const capabilities = [
    ...CAPABILITIES,
    {
      capability: 'cell.approve_leadership',
      scope_type: 'SUBTREE_EXCL_SELF',
      scope_network: null,
      read_only: false,
      source: 'ROLE',
    },
  ];

  await page.route('**/api/v1/auth/me', (route) => route.fulfill(json({ ...ME, capabilities })));
}

/**
 * The same account, also holding `cell.manage_lifecycle` at Whole Church, as Admin does: the
 * Cells page then offers the administrator's lists (decision 0366). `approver` adds
 * `cell.approve_leadership` at Whole Church too, which Admin also holds.
 */
export async function mockCellAdministrator(
  page: Page,
  { approver = false }: { approver?: boolean } = {},
): Promise<void> {
  const grant = (capability: string) => ({
    capability,
    scope_type: 'WHOLE_CHURCH',
    scope_network: null,
    read_only: false,
    source: 'ROLE',
  });
  const capabilities = [
    ...CAPABILITIES,
    grant('cell.manage_lifecycle'),
    ...(approver ? [grant('cell.approve_leadership')] : []),
  ];

  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill(json({ ...ME, roles: ['ADMIN'], capabilities })),
  );
}

/**
 * The same account, also holding `people.correct_sex` and `records.backdate_effective_date`
 * at Whole Church, as Admin does: the person page then offers Correct sex (decision 0367).
 */
export async function mockSexCorrector(page: Page): Promise<void> {
  const grant = (capability: string) => ({
    capability,
    scope_type: 'WHOLE_CHURCH',
    scope_network: null,
    read_only: false,
    source: 'ROLE',
  });
  const capabilities = [
    ...CAPABILITIES,
    grant('people.correct_sex'),
    grant('records.backdate_effective_date'),
  ];

  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill(json({ ...ME, roles: ['ADMIN'], capabilities })),
  );
}

export const CREATED_CELL = { id: '3f1b7c6e-0000-4000-8000-000000000199', cell_id: 'CELL-000031' };

/** `POST /cells`, accepted. Returns every body sent. */
export async function mockCellCreated(page: Page): Promise<unknown[]> {
  const sent: unknown[] = [];

  await page.route('**/api/v1/cells', (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    sent.push(route.request().postDataJSON());
    return route.fulfill(json({ ...CREATED_CELL, state: 'ACTIVE' }, 201));
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

/** The months *Absent 3+ Months* covers in these fixtures (decision 0397). */
export const ABSENT_MONTHS = ['2026-03', '2026-04', '2026-05'];

/**
 * *Absent 3+ Months* (decision 0397): somebody away three months, and a leader whose Cell did
 * not meet, whose row carries no Archive. Names are invented.
 */
export async function mockAbsentPeople(page: Page): Promise<void> {
  await page.route('**/api/v1/people/absent*', (route) =>
    route.fulfill(
      json({
        months: ABSENT_MONTHS,
        data: [
          {
            id: '3f1b7c6e-0000-4000-8000-000000000951',
            member_id: 'M-001051',
            full_name: 'Dalisay Ocampo',
            leader: { person_id: '3f1b7c6e-0000-4000-8000-000000000903', full_name: 'Rogelio Mendoza' },
            cell: { id: '3f1b7c6e-0000-4000-8000-000000000101', cell_id: 'CELL-000007', category: 'YOUTH', day_of_week: 3 },
            leads: [],
            pastors: 0,
            last_at_cell: '2026-02-11',
            last_at_dcc: null,
          },
          {
            id: '3f1b7c6e-0000-4000-8000-000000000952',
            member_id: 'M-001052',
            full_name: 'Ernesto Villar',
            leader: { person_id: '3f1b7c6e-0000-4000-8000-000000000903', full_name: 'Rogelio Mendoza' },
            cell: null,
            leads: [
              { id: '3f1b7c6e-0000-4000-8000-000000000112', cell_id: 'CELL-000012', category: 'YOUNG_PRO', day_of_week: 6, members: 3 },
            ],
            pastors: 0,
            last_at_cell: '2026-02-21',
          },
          {
            id: '3f1b7c6e-0000-4000-8000-000000000953',
            member_id: 'M-001053',
            full_name: 'Gloria Pascual',
            leader: { person_id: '3f1b7c6e-0000-4000-8000-000000000903', full_name: 'Rogelio Mendoza' },
            cell: { id: '3f1b7c6e-0000-4000-8000-000000000101', cell_id: 'CELL-000007', category: 'YOUTH', day_of_week: 3 },
            leads: [],
            pastors: 2,
            last_at_cell: null,
            last_at_dcc: '2026-02-15',
          },
        ],
        next_cursor: null,
      }),
    ),
  );
}

/** The Admin's *Archived* view (decision 0397). */
export async function mockArchivedPeople(page: Page): Promise<void> {
  await page.route('**/api/v1/people/archived*', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: '3f1b7c6e-0000-4000-8000-000000000961',
            member_id: 'M-001061',
            full_name: 'Florante Medina',
            archived_at: '2026-06-02T03:00:00.000Z',
            reason: 'MOVED_AWAY',
            note: null,
            leader: { person_id: '3f1b7c6e-0000-4000-8000-000000000903', full_name: 'Rogelio Mendoza' },
            cell: { id: '3f1b7c6e-0000-4000-8000-000000000101', cell_id: 'CELL-000007', category: 'YOUTH', day_of_week: 3 },
          },
        ],
        next_cursor: null,
      }),
    ),
  );
}

/**
 * The administrator above, also holding `people.manage_lifecycle` and `accounts.manage` at Whole
 * Church as the role does, so Archive and Restore are offered (decision 0397).
 */
export async function mockLifecycleAdministrator(page: Page): Promise<void> {
  const wholeChurch = (capability: string) => ({
    capability,
    scope_type: 'WHOLE_CHURCH',
    scope_network: null,
    read_only: false,
    source: 'ROLE',
  });
  const capabilities = [
    ...CAPABILITIES.map((grant) =>
      grant.capability === 'reports.view_subtree' || grant.capability === 'people.view_subtree'
        ? wholeChurch(grant.capability)
        : grant,
    ),
    wholeChurch('people.manage_lifecycle'),
    wholeChurch('accounts.manage'),
  ];

  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill(json({ ...ME, roles: ['ADMIN'], capabilities })),
  );
}

/**
 * The pre-flight lookup with something to show — a Tier 2 candidate the viewer
 * pastors, and one whose details section 8 withholds.
 *
 * The withheld one carries `possible_match` and nothing that names them, which is what
 * the API sends (decision 0405). A fixture that omitted the flag would let the client's
 * inference-from-shape pass unnoticed, which is the drift this file claims not to permit.
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
          { possible_match: true },
          {
            // **`possible_match` *with* a tier and a name**, which the API does not
            // send — and that is the point. The other withheld fixture carries the flag
            // and no tier, so `isWithheld` answers the same whether it reads the flag
            // or falls back to the missing tier, and the fix for reading the flag is
            // pinned by nothing. This one separates them: it must be treated as
            // withheld, which only the flag can decide, and its name never shown.
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
 * Two archived candidates (decision 0404): one outside the viewer's branch, carrying only
 * `possible_match` and `archived` (decision 0405), and one the viewer pastors, carrying a
 * tier and `archived`.
 */
export const ARCHIVED_MATCHES = [
  { possible_match: true, archived: true },
  {
    // Not the person a profile spec edits, so Edit details lists it too.
    id: '44444444-5555-4666-8777-888888888888',
    member_id: 'M-000316',
    full_name: 'Corazon Dizon Ramos',
    sex: 'FEMALE',
    tier: 2,
    reasons: ['Same first and last name'],
    archived: true,
  },
];

export async function mockArchivedMatches(page: Page): Promise<void> {
  await page.route('**/api/v1/people/duplicate-candidates*', (route) =>
    route.fulfill(json({ data: ARCHIVED_MATCHES })),
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
                  // The API never refuses on a withheld candidate (section 3), and the
                  // screen lists only the ones it may show; this one is left out.
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

/** The code the fake authenticator shows, for `mockSecondStep`. */
export const SECOND_STEP_CODE = '123456';

/** Ten invented recovery codes, as setup returns them. */
export const RECOVERY_CODES = [
  'a7kq-3m9x',
  'p2vt-8hwe',
  'n4rz-6cb1',
  'x9dj-2kfu',
  'm3sy-7qla',
  'w6ge-2tpo',
  'c8hn-5vzr',
  't3bu-4xmd',
  'k5wf-9jse',
  'r7pq-8ynh',
];

/**
 * An administrator's or Senior Pastor's sign-in (decision 0302): the password step answers
 * with a ticket, and the second step accepts `SECOND_STEP_CODE` and refuses anything else
 * with four tries left. `SETUP` walks through setup first. `/auth/me` answers for the
 * signed-in session, so the landing redirect has somewhere to go.
 */
export async function mockSecondStep(page: Page, mode: 'CODE' | 'SETUP'): Promise<void> {
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill(json({ second_step: mode, challenge: 'test-challenge', expires_in: 300 })),
  );

  const refuseOr = (ok: unknown) => (route: import('@playwright/test').Route) => {
    const body = route.request().postDataJSON() as { code?: string; recovery_code?: string };
    const right = body.code === SECOND_STEP_CODE || RECOVERY_CODES.includes(body.recovery_code ?? '');
    return route.fulfill(
      right
        ? json(ok)
        : json(
            {
              error: {
                code: 'UNAUTHENTICATED',
                message: 'That code did not work. 4 tries left, then you sign in again from the start.',
                details: { reason: 'CODE_INCORRECT', attempts_left: 4 },
              },
            },
            401,
          ),
    );
  };

  await page.route('**/api/v1/auth/second-step', refuseOr(SESSION_TOKENS));
  await page.route('**/api/v1/auth/second-step/setup', (route) =>
    route.fulfill(
      json({
        key: 'JBSWY3DPEHPK3PXP',
        otpauth_uri:
          'otpauth://totp/DFC%20Report%3Aadmin%40example.invalid?secret=JBSWY3DPEHPK3PXP&issuer=DFC+Report',
      }),
    ),
  );
  await page.route(
    '**/api/v1/auth/second-step/setup/confirm',
    refuseOr({ ...SESSION_TOKENS, recovery_codes: RECOVERY_CODES }),
  );
  await page.route('**/api/v1/auth/me', (route) => route.fulfill(json(ME)));
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
