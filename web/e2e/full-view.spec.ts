import { expect, test, type Page } from '@playwright/test';

import {
  MEMBER_CHOICES,
  PERSON_IN_SCOPE,
  SIGNED_IN_PERSON_ID,
  chooseThreeMembers,
  mockAwaitingReassignment,
  mockGrants,
  mockMemberSearch,
  mockPeople,
  mockPeopleWithoutACell,
  mockScreens,
  mockSignedIn,
} from './mock-api';
import {
  CELL_WITH_MEETINGS,
  CELL_WITH_NO_SCHEDULE,
  mockCellMeetings,
  mockCellMembers,
  mockCellReport,
  mockCells,
  mockCellsEmpty,
  mockDccEvents,
  mockDccReport,
  mockDccRoster,
  mockMeetingsAwaiting,
  mockPastoralPath,
  recordingStatus,
  mockPendingDcc,
} from './mock-attendance';
import { mockSuynl } from './mock-growth';

/**
 * The screens an account has, as the server names them (SKILL.md sections 7 and 19,
 * decisions 0323 and 0325).
 *
 * A Recording-only account (`screens: 'RECORDING'`) has `Record · People · Cells · SUYNL`,
 * one list on Record, no Branch tab, its own Cells with no removal, and SUYNL as an item of
 * its own. A Senior Pastor (`screens: 'SENIOR_PASTOR'`) opens Record on Recording Progress. Full
 * view is ticked on the person page by a holder of `roles.manage`.
 *
 * What these screens leave out is not what keeps a route closed: the API refuses decision
 * 0323's point 2 routes, and `api/test` pins that. These cases pin what the client shows and
 * what it sends. Names are invented (`CLAUDE.md`, Secrets).
 */

/** 10:00 on 20 June 2026 in Manila, the month the attendance mocks describe. */
const JUNE_20 = new Date('2026-06-20T02:00:00Z');

/** 10:00 on Thursday 8 October 2026 in Manila: the week of 5 October, past the 7th. */
const OCTOBER_8 = new Date('2026-10-08T02:00:00Z');

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

/** Every API path the page asked for, with its query, in order. */
function trackApi(page: Page): string[] {
  const asked: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/')) {
      asked.push(`${request.method()} ${url.pathname}${url.search}`);
    }
  });
  return asked;
}

function mainNavigation(page: Page) {
  return page.getByRole('navigation', { name: 'Main' });
}

test.describe('a Recording-only account (decision 0323)', () => {
  test('has Record, People, Cells and SUYNL in the sidebar, and nothing else', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockScreens(page, 'RECORDING');
    await mockPeople(page);

    await page.goto('/people');

    const links = mainNavigation(page).getByRole('link');
    await expect(links).toHaveText(['Record', 'People', 'Cells', 'SUYNL']);
    await expect(mainNavigation(page).getByRole('link', { name: 'Cells' })).toHaveAttribute(
      'href',
      '/my-cell',
    );
    await expect(mainNavigation(page).getByRole('link', { name: 'SUYNL' })).toHaveAttribute(
      'href',
      '/growth/suynl',
    );
  });

  test('a Full view account has Record, Reports, People, Cells and SUYNL (decision 0383)', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);

    await page.goto('/people');

    await expect(mainNavigation(page).getByRole('link')).toHaveText([
      'Record',
      'Reports',
      'People',
      'Cells',
      'SUYNL',
    ]);
  });

  test('a whole-church reader, as the Admin is, keeps Growth (decision 0383)', async ({ page }) => {
    await mockSignedIn(page);
    await mockGrants(page, ['reports.view_subtree', 'suynl.view_subtree'], { wholeChurch: true });
    await mockPeople(page);

    await page.goto('/people');

    await expect(mainNavigation(page).getByRole('link')).toHaveText([
      'Record',
      'Reports',
      'People',
      'Cells',
      'Growth',
    ]);
  });

  // It said "keeps the five items" and passed only by matching the sidebar before `/auth/me`
  // answered, when every account shows the default five; decision 0326 gave them three, and
  // decision 0377 folded Trends into Reports.
  test('a Senior Pastor has Record and Reports', async ({ page }) => {
    await mockSignedIn(page);
    await mockScreens(page, 'SENIOR_PASTOR');
    await mockPeople(page);

    await page.goto('/people');

    await expect(mainNavigation(page).getByRole('link')).toHaveText(['Record', 'Reports']);
  });

  async function mockRecord(page: Page) {
    await mockSignedIn(page);
    await mockCellMeetings(page);
    await mockMeetingsAwaiting(page);
    await mockDccEvents(page);
    await mockDccRoster(page);
  }

  test('Record shows Awaiting a record alone, and asks for no other list or figure', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    await mockScreens(page, 'RECORDING');
    const asked = trackApi(page);

    // An address naming another list still opens the one this account has.
    await page.goto('/dashboard?list=behind');

    await expect(page.getByRole('region', { name: 'Update Records' })).toBeVisible();
    // One tab names the list, in the frame every account has (owner, 2026-10-19), so the pane
    // repeats no heading (decision 0362).
    await expect(page.getByRole('group', { name: 'Record', exact: true }).getByRole('button')).toHaveText([
      /^Update Records/,
    ]);
    await expect(page.getByRole('heading', { level: 2, name: 'Update Records' })).toHaveCount(0);
    await expect(page.getByText('What still needs a record.')).toBeVisible();
    await expect(
      page.getByRole('link', { name: /^Record Young Pro · Sat,/ }).first(),
    ).toBeVisible();

    await expect(page.getByRole('group', { name: 'Outstanding work' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Pending CG Records' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Recording Progress' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Your requests' })).toHaveCount(0);

    // Its other lists and the month figures are not asked for, and the API's refusals are
    // never met.
    expect(asked.filter((request) => /\/api\/v1\/cells\?/.test(request))).toEqual([]);
    expect(asked.filter((request) => request.includes('/people/awaiting-reassignment'))).toEqual(
      [],
    );
    expect(asked.filter((request) => request.includes('/cells/people-without-a-cell'))).toEqual([]);
    expect(asked.filter((request) => request.includes('/api/v1/reports/'))).toEqual([]);
  });

  test('Record offers no Leaders Under Me while no leader with an account is beneath', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    await mockScreens(page, 'RECORDING', { peopleIOversee: false });
    const asked = trackApi(page);

    // The branch view in the address is not honoured when the server withholds it.
    await page.goto('/dashboard?whose=branch');

    await expect(page.getByRole('region', { name: 'Update Records' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: /^Record Young Pro · Sat,/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Leaders Under Me' })).toHaveCount(0);

    // The reader's own queue is the one asked for and shown: the branch view's downline row
    // (Ana Lim, in `mockMeetingsAwaiting`) is not on the page.
    await expect
      .poll(() =>
        asked.some(
          (request) =>
            request.includes('/cells/meetings/awaiting') && request.includes('whose=mine'),
        ),
      )
      .toBe(true);
    await expect(page.getByText('Ana Lim')).toHaveCount(0);
    // Not even once before the account answers.
    expect(asked.filter((request) => request.includes('whose=branch'))).toEqual([]);
  });

  test('Record offers Leaders Under Me where the server says a leader with an account is beneath', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockRecord(page);
    await mockScreens(page, 'RECORDING', { peopleIOversee: true });

    await page.goto('/dashboard');

    // Decision 0333: the second choice names what each half holds.
    await expect(page.getByRole('radio', { name: 'Leaders Under Me', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Own Cell', exact: true })).toBeChecked();
    await page.getByRole('button', { name: /^DCC/ }).click();
    await expect(page.getByRole('radio', { name: 'Own 12', exact: true })).toBeChecked();
  });

  test('People has no Branch tab', async ({ page }) => {
    await mockSignedIn(page);
    await mockScreens(page, 'RECORDING');
    await mockPeople(page);

    await page.goto('/people');

    await expect(mainNavigation(page).getByRole('link', { name: 'Cells' })).toBeVisible();
    // The People tab alone, in the same frame (owner, 2026-10-19).
    await expect(page.getByRole('navigation', { name: 'People' }).getByRole('link')).toHaveText([
      'Add People',
    ]);
    await expect(page.getByRole('link', { name: 'Branch', exact: true })).toHaveCount(0);
  });

  test('a Full view account’s People carries Add People and Family Tree, # of People being under Reports (decision 0376)', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);

    await page.goto('/people');

    await expect(page.getByRole('navigation', { name: 'People' }).getByRole('link')).toHaveText([
      'Add People',
      /^Awaiting Leader Assignment/,
      'Family Tree',
    ]);
  });

  test('SUYNL is reached from its own item, with SUYNL its one Growth tab', async ({ page }) => {
    await mockSignedIn(page);
    await mockScreens(page, 'RECORDING');
    await mockPeople(page);
    await mockSuynl(page);

    await page.goto('/people');
    await mainNavigation(page).getByRole('link', { name: 'SUYNL' }).click();

    await expect(page).toHaveURL(/\/growth\/suynl$/);
    await expect(page.getByRole('heading', { level: 1, name: 'SUYNL' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dalisay Soriano' }).first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Growth' }).getByRole('link')).toHaveText([
      'SUYNL',
    ]);
    await expect(mainNavigation(page).locator('a[aria-current="page"]')).toHaveText('SUYNL');
  });
});

test.describe('My Cell (decision 0323)', () => {
  test('lists the Cells the account leads, each with its members and this month’s meetings', async ({
    page,
  }) => {
    await page.clock.setFixedTime(JUNE_20);
    await mockSignedIn(page);
    await mockScreens(page, 'RECORDING');
    await mockCells(page);
    const asked = trackApi(page);

    await page.goto('/my-cell');

    // The page keeps its title while its sidebar item reads Cells (decision 0371).
    await expect(page.getByRole('heading', { level: 1, name: 'My Cell' })).toBeVisible();
    // One tab and its pane, as every account's screens have (owner, 2026-10-19).
    await expect(page.getByRole('navigation', { name: 'Cells' }).getByRole('link')).toHaveText([
      'My Cell',
    ]);
    await expect(page.getByText('The Cells you lead, in June 2026.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Youth · Sat',
      'Couple · Wed',
    ]);
    await expect(page.getByText('CELL-000007 · Saturdays at 19:00 · 6 members')).toBeVisible();

    const members = page.getByRole('link', { name: 'Members' });
    await expect(members).toHaveCount(2);
    await expect(members.first()).toHaveAttribute(
      'href',
      `/cells/${CELL_WITH_MEETINGS.id}/members`,
    );
    await expect(members.nth(1)).toHaveAttribute(
      'href',
      `/cells/${CELL_WITH_NO_SCHEDULE.id}/members`,
    );
    await expect(page.getByRole('link', { name: 'This month’s meetings' }).first()).toHaveAttribute(
      'href',
      `/cells/${CELL_WITH_MEETINGS.id}/meetings?month=2026-06-01`,
    );

    await expect(mainNavigation(page).locator('a[aria-current="page"]')).toHaveText('Cells');

    // The account's own Cells, not every Cell of its scope.
    const index = asked.filter((request) => request.startsWith('GET /api/v1/cells?'));
    expect(index.length).toBeGreaterThan(0);
    for (const request of index) {
      expect(request).toContain('led_by=me');
    }
  });

  test('says so when the account leads no Cell, and still offers to ask for one', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockScreens(page, 'RECORDING');
    await mockCellsEmpty(page);

    await page.goto('/my-cell');

    await expect(
      page.getByText(
        'You do not lead a Cell. Ask for a new one, and it is sent for approval.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ask for a new Cell' })).toBeVisible();
  });

  test('asks for a new Cell led by somebody the account oversees, and lists the request sent', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockScreens(page, 'RECORDING');
    await mockCells(page);
    await mockPeople(page);
    const memberSearches = await mockMemberSearch(page);

    let sentRequests: unknown[] = [];
    await page.route('**/api/v1/cells/leadership-requests/sent*', (route) =>
      route.fulfill(json({ data: sentRequests, next_cursor: null })),
    );
    const posted: { body: unknown; key: string | undefined }[] = [];
    await page.route('**/api/v1/cells/leadership-requests', (route) => {
      if (route.request().method() !== 'POST') {
        return route.fallback();
      }
      posted.push({
        body: route.request().postDataJSON(),
        key: route.request().headers()['idempotency-key'],
      });
      sentRequests = [
        {
          id: '3f1b7c6e-0000-4000-8000-000000000951',
          kind: 'NEW_CELL',
          state: 'PENDING',
          requested_at: '2026-06-20T02:00:00Z',
          decided_at: null,
          prospective_leader: {
            person_id: PERSON_IN_SCOPE.id,
            full_name: PERSON_IN_SCOPE.full_name,
          },
          cell: null,
          restart_of: null,
          decline_reason: null,
          note: null,
        },
      ];
      return route.fulfill(
        json({ id: '3f1b7c6e-0000-4000-8000-000000000951', state: 'PENDING' }, 201),
      );
    });

    await page.goto('/my-cell');
    await expect(page.getByRole('heading', { level: 2, name: 'Youth · Sat' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your requests' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Ask for a new Cell' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ask for a new Cell' });
    const send = dialog.getByRole('button', { name: 'Send for approval' });
    await expect(send).toBeDisabled();

    await dialog.getByLabel('Search for the leader by name').fill('Marilou');
    // The leader's picker comes first; the three member pickers follow it (decision 0353).
    await dialog.getByRole('button', { name: 'Search people' }).first().click();
    await dialog.getByRole('button', { name: 'Choose' }).first().click();
    await dialog.getByRole('radio', { name: 'Couple' }).check();
    await dialog.getByRole('radio', { name: 'Wednesday' }).check();
    await expect(send).toBeDisabled();
    await dialog.getByLabel('What time').fill('19:30');
    // Three members besides the leader are needed before it can be sent (decision 0353).
    await expect(send).toBeDisabled();
    await chooseThreeMembers(dialog);
    // The members are people the leader oversees, so the search never reaches the church
    // (decision 0369). The three pickers share one cached search for the same term.
    expect(memberSearches.length).toBeGreaterThan(0);
    for (const url of memberSearches) {
      expect(url).not.toContain('church_wide');
    }
    await send.click();

    await expect(dialog).toBeHidden();
    expect(posted.map((entry) => entry.body)).toEqual([
      {
        kind: 'NEW_CELL',
        prospective_leader_id: PERSON_IN_SCOPE.id,
        category: 'COUPLE',
        day_of_week: 3,
        time_of_day: '19:30',
        members: MEMBER_CHOICES.map((member) => member.id),
      },
    ]);
    expect(posted[0].key).toBeTruthy();

    // The sent list is asked again, so the request shows at once.
    const sent = page.getByRole('region', { name: 'Your requests' });
    await expect(sent.getByRole('listitem')).toHaveCount(1);
    await expect(sent).toContainText(`New Cell led by ${PERSON_IN_SCOPE.full_name}`);
    await expect(sent).toContainText('Waiting for approval');
  });
});

test.describe('a Cell’s members, by the screens the account has', () => {
  const MEMBERS = `/cells/${CELL_WITH_MEETINGS.id}/members`;

  test('a Recording-only account adds members and is offered no Remove', async ({ page }) => {
    await mockSignedIn(page);
    await mockScreens(page, 'RECORDING');
    await mockCellMeetings(page);
    await mockCellMembers(page);

    await page.goto(MEMBERS);

    // The sidebar's own items prove the account has loaded before Remove's absence is read.
    await expect(mainNavigation(page).locator('a[aria-current="page"]')).toHaveText('Cells');
    await expect(page.getByRole('link', { name: 'Rosalinda Ocampo' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a member' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  });

  test('a Full view account that moves no members is offered no Remove (decision 0357)', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellMeetings(page);
    await mockCellMembers(page);

    await page.goto(MEMBERS);

    await expect(page.getByRole('link', { name: 'Rosalinda Ocampo' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a member' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  });

  test('an account holding cell.move_members is offered Remove (decision 0357)', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockGrants(page, ['cell.move_members']);
    await mockCellMeetings(page);
    await mockCellMembers(page);

    await page.goto(MEMBERS);

    await expect(page.getByRole('link', { name: 'Rosalinda Ocampo' }).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Remove' }).filter({ visible: true }),
    ).toHaveCount(2);
  });

  test('Add a member says who moves somebody in another Cell, by what the account may do (decision 0357)', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockCellMeetings(page);
    await mockCellMembers(page);
    await page.goto(MEMBERS);

    await page.getByRole('button', { name: 'Add a member' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByText(
        'It takes effect today. Somebody already in another Cell is moved by their Primary.',
      ),
    ).toBeVisible();

    await mockGrants(page, ['cell.move_members']);
    await page.reload();
    await page.getByRole('button', { name: 'Add a member' }).click();
    await expect(
      page
        .getByRole('dialog')
        .getByText('It takes effect today. Somebody already in another Cell moves here.'),
    ).toBeVisible();
  });
});

test.describe('Full view on the person page (decision 0323, point 1)', () => {
  const PROFILE = `/people/${PERSON_IN_SCOPE.id}`;
  const ACCOUNT_ID = '3f1b7c6e-0000-4000-8000-000000000901';

  async function accountHolding(
    page: Page,
    role: 'LEADER' | 'SENIOR_PASTOR',
    state: { fullView: boolean },
  ) {
    await page.route(`**/api/v1/accounts/for-person/${PERSON_IN_SCOPE.id}`, (route) =>
      route.fulfill(
        json({
          account: {
            id: ACCOUNT_ID,
            email: 'marilou@example.test',
            status: 'ACTIVE',
            roles: [role],
            created_at: '2026-09-22T02:00:00.000Z',
            second_step: {
              required: role === 'SENIOR_PASTOR',
              set_up_at: role === 'SENIOR_PASTOR' ? '2026-09-28T02:00:00.000Z' : null,
            },
            full_view: state.fullView,
          },
        }),
      ),
    );
  }

  test('ticks and clears Full view for a holder of roles.manage, sending each change', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockGrants(page, ['accounts.manage', 'roles.manage']);
    await mockPastoralPath(page);
    const state = { fullView: false };
    await accountHolding(page, 'LEADER', state);
    const sent: { path: string; body: unknown }[] = [];
    await page.route('**/api/v1/accounts/*/full-view', (route) => {
      const body = route.request().postDataJSON() as { full_view: boolean };
      sent.push({ path: new URL(route.request().url()).pathname, body });
      state.fullView = body.full_view;
      return route.fulfill(json({ id: ACCOUNT_ID, full_view: body.full_view }));
    });

    await page.goto(PROFILE);

    const box = page.getByRole('checkbox', { name: /^Full view/ });
    await expect(box).not.toBeChecked();
    // Approves Cells is offered only with Full view (decision 0352).
    await expect(page.getByRole('checkbox', { name: /^Approves Cells/ })).toHaveCount(0);
    await expect(
      page.getByText('Marilou sees the recording screens: Record, People, Cells and SUYNL.'),
    ).toBeVisible();

    // `click` rather than `check`: the box is controlled, and shows the new value once the
    // save is under way rather than in the click's own event, which `check` reads as unchanged.
    await box.click();
    await expect(box).toBeChecked();
    await expect(
      page.getByText('Marilou sees Record, Reports, People, Cells and SUYNL over their branch.'),
    ).toBeVisible();
    await expect.poll(() => sent.length).toBe(1);
    await expect(box).toBeEnabled();
    await expect(box).toBeChecked();
    expect(sent).toEqual([
      { path: `/api/v1/accounts/${ACCOUNT_ID}/full-view`, body: { full_view: true } },
    ]);

    await box.click();
    await expect(box).not.toBeChecked();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toEqual({
      path: `/api/v1/accounts/${ACCOUNT_ID}/full-view`,
      body: { full_view: false },
    });
    // Saved and read again, the box keeps the value the server holds.
    await expect(box).toBeEnabled();
    await expect(box).not.toBeChecked();
  });

  test('ticks Approves Cells beside Full view, sending it on its own route (decision 0352)', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockGrants(page, ['accounts.manage', 'roles.manage']);
    await mockPastoralPath(page);
    let approvesCells = false;
    await page.route(`**/api/v1/accounts/for-person/${PERSON_IN_SCOPE.id}`, (route) =>
      route.fulfill(
        json({
          account: {
            id: ACCOUNT_ID,
            email: 'marilou@example.test',
            status: 'ACTIVE',
            roles: ['LEADER'],
            created_at: '2026-09-22T02:00:00.000Z',
            second_step: { required: false, set_up_at: null },
            full_view: true,
            approves_cells: approvesCells,
          },
        }),
      ),
    );
    const sent: { path: string; body: unknown }[] = [];
    await page.route('**/api/v1/accounts/*/approves-cells', (route) => {
      const body = route.request().postDataJSON() as { approves_cells: boolean };
      sent.push({ path: new URL(route.request().url()).pathname, body });
      approvesCells = body.approves_cells;
      return route.fulfill(json({ id: ACCOUNT_ID, approves_cells: body.approves_cells }));
    });

    await page.goto(PROFILE);

    const box = page.getByRole('checkbox', { name: /^Approves Cells/ });
    await expect(box).not.toBeChecked();
    await expect(page.getByText('Marilou does not approve Cells; an administrator does.')).toBeVisible();

    await box.click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent).toEqual([
      { path: `/api/v1/accounts/${ACCOUNT_ID}/approves-cells`, body: { approves_cells: true } },
    ]);
    await expect(
      page.getByText(
        'Marilou approves new Cells, handovers and restarts in their branch, except their own and those for their own disciples.',
      ),
    ).toBeVisible();
  });

  test('ticks Moves people beside Approves Cells, sending it on its own route (decision 0356)', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockGrants(page, ['accounts.manage', 'roles.manage']);
    await mockPastoralPath(page);
    let movesPeople = false;
    await page.route(`**/api/v1/accounts/for-person/${PERSON_IN_SCOPE.id}`, (route) =>
      route.fulfill(
        json({
          account: {
            id: ACCOUNT_ID,
            email: 'marilou@example.test',
            status: 'ACTIVE',
            roles: ['LEADER'],
            created_at: '2026-09-22T02:00:00.000Z',
            second_step: { required: false, set_up_at: null },
            full_view: true,
            approves_cells: false,
            moves_people: movesPeople,
          },
        }),
      ),
    );
    const sent: { path: string; body: unknown }[] = [];
    await page.route('**/api/v1/accounts/*/moves-people', (route) => {
      const body = route.request().postDataJSON() as { moves_people: boolean };
      sent.push({ path: new URL(route.request().url()).pathname, body });
      movesPeople = body.moves_people;
      return route.fulfill(json({ id: ACCOUNT_ID, moves_people: body.moves_people }));
    });

    await page.goto(PROFILE);

    const box = page.getByRole('checkbox', { name: /^Moves people/ });
    await expect(box).not.toBeChecked();
    await expect(page.getByText('Marilou does not move people to another leader.')).toBeVisible();

    await box.click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent).toEqual([
      { path: `/api/v1/accounts/${ACCOUNT_ID}/moves-people`, body: { moves_people: true } },
    ]);
    await expect(
      page.getByText(
        'Marilou moves anyone in their branch to another leader at once. A move to another branch is made by the Admin.',
      ),
    ).toBeVisible();
  });

  test('offers Moves people only with Full view (decision 0356)', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockGrants(page, ['accounts.manage', 'roles.manage']);
    await mockPastoralPath(page);
    await accountHolding(page, 'LEADER', { fullView: false });

    await page.goto(PROFILE);

    await expect(page.getByRole('checkbox', { name: /^Full view/ })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /^Moves people/ })).toHaveCount(0);
  });

  test('is not offered to a reader without roles.manage', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockGrants(page, ['accounts.manage']);
    await mockPastoralPath(page);
    await accountHolding(page, 'LEADER', { fullView: false });

    await page.goto(PROFILE);

    // The account block has loaded: its status is shown.
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /^Full view/ })).toHaveCount(0);
  });

  test('is not offered on a Senior Pastor’s account, which Full view does not change', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockGrants(page, ['accounts.manage', 'roles.manage']);
    await mockPastoralPath(page);
    await accountHolding(page, 'SENIOR_PASTOR', { fullView: false });

    await page.goto(PROFILE);

    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /^Full view/ })).toHaveCount(0);
  });
});

test.describe('the Senior Pastors’ Record (decision 0325)', () => {
  async function mockSeniorPastor(page: Page, answer: (url: URL) => unknown = defaultAnswer) {
    await mockSignedIn(page);
    await mockScreens(page, 'SENIOR_PASTOR');
    await mockCellMeetings(page);
    await mockMeetingsAwaiting(page);
    await mockDccEvents(page);
    await mockDccRoster(page);

    const asked: URLSearchParams[] = [];
    await page.route('**/api/v1/reports/recording-status?*', (route) => {
      const url = new URL(route.request().url());
      asked.push(url.searchParams);
      return route.fulfill(json(answer(url)));
    });

    return asked;
  }

  function defaultAnswer(url: URL) {
    const kind = url.searchParams.get('kind') === 'MONTH' ? 'MONTH' : 'WEEK';
    const start = url.searchParams.get('start') ?? '2026-10-05';
    return recordingStatus(kind, start, start);
  }

  function box(page: Page, label: string) {
    // Each box's label stands alone under one Whole Church heading (decision 0327).
    return page.getByText(label, { exact: true }).locator('..');
  }

  test('opens on Recording Progress, with Awaiting a record as the other tab', async ({ page }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSeniorPastor(page);

    await page.goto('/dashboard');

    const tabs = page.getByRole('group', { name: 'Record' });
    await expect(tabs.getByRole('button')).toHaveText(['Recording Progress', /^Update Records/]);
    await expect(tabs.getByRole('button', { name: 'Recording Progress' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // No heading of its own: the tab names it (decision 0327).
    await expect(page.getByRole('region', { name: 'Recording Progress' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recording Progress' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Update Records' })).toHaveCount(0);
    // No figure links anywhere: no Pending list sits beside it (decision 0370).
    await expect(page.getByText('Celestino Ocampo').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Pending (CG|DCC) Records/ })).toHaveCount(0);
    // None of the other lists of section 19, and no month figures.
    await expect(page.getByRole('group', { name: 'Outstanding work' })).toHaveCount(0);

    await tabs.getByRole('button', { name: /^Update Records/ }).click();

    await expect(page).toHaveURL(/list=awaiting/);
    await expect(page.getByRole('region', { name: 'Update Records' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Recording Progress' })).toHaveCount(0);
    // Their own work only: no Whose switch.
    await expect(page.getByRole('group', { name: 'Whose' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Leaders Under Me' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Record Young Pro · / }).first()).toBeVisible();

    await tabs.getByRole('button', { name: 'Recording Progress' }).click();
    await expect(page).not.toHaveURL(/list=awaiting/);
    await expect(page.getByRole('region', { name: 'Recording Progress' })).toBeVisible();
  });

  test('opens on the current week and asks for the period the Week and Month switch names', async ({
    page,
  }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    const asked = await mockSeniorPastor(page);

    await page.goto('/dashboard');

    const period = page.getByRole('group', { name: 'Period' });
    await expect(period.getByRole('button', { name: 'Week' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText(/^5 Oct – 11 Oct 2026/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'The period after' })).toBeDisabled();
    await expect.poll(() => asked.length).toBeGreaterThan(0);
    expect(Object.fromEntries(asked[asked.length - 1])).toEqual({
      kind: 'WEEK',
      start: '2026-10-05',
      period: '2026-10-01',
    });

    await page.getByRole('button', { name: 'The period before' }).click();
    await expect(page.getByText(/^28 Sept? – 4 Oct 2026/)).toBeVisible();
    await expect
      .poll(() => Object.fromEntries(asked[asked.length - 1]))
      .toEqual({
        kind: 'WEEK',
        start: '2026-09-28',
        period: '2026-10-01',
      });

    await period.getByRole('button', { name: 'Month' }).click();
    await expect(page.getByText(/^October 2026/)).toBeVisible();
    await expect
      .poll(() => Object.fromEntries(asked[asked.length - 1]))
      .toEqual({
        kind: 'MONTH',
        start: '2026-10-01',
        period: '2026-10-01',
      });
    await expect(page.getByRole('button', { name: 'The period after' })).toBeDisabled();

    await page.getByRole('button', { name: 'The period before' }).click();
    await expect(page.getByText(/^September 2026/)).toBeVisible();
    await expect
      .poll(() => Object.fromEntries(asked[asked.length - 1]))
      .toEqual({
        kind: 'MONTH',
        start: '2026-09-01',
        period: '2026-09-01',
      });
  });

  test('shows the whole church as two boxes, each X of Y leaders with its percentage and the week before', async ({
    page,
  }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSeniorPastor(page);

    await page.goto('/dashboard');

    const cell = box(page, 'Recorded their Cell group');
    await expect(cell).toContainText('6 of 10 leaders · 60%');
    await expect(cell).toContainText('Last week: 5 of 9 leaders');
    const dcc = box(page, 'Recorded their DCC checklist');
    await expect(dcc).toContainText('9 of 13 leaders · 69%');
    await expect(dcc).toContainText('Last week: 8 of 11 leaders');
    await expect(page.getByText(/^Open until /)).toBeVisible();
  });

  test('a box reading 0 of 0 shows no percentage, and an open period before says so', async ({
    page,
  }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSeniorPastor(page, (url) => {
      const status = defaultAnswer(url);
      return {
        ...status,
        whole_church: {
          cell: { recorded: 0, owed: 0, percent: null },
          dcc: { recorded: 1, owed: 1, percent: 100 },
        },
        previous: { ...status.previous, open: true },
      };
    });

    await page.goto('/dashboard');

    const cell = box(page, 'Recorded their Cell group');
    await expect(cell).toContainText('0 of 0 leaders');
    await expect(cell).not.toContainText('%');
    await expect(cell).toContainText('Last week (still open): 5 of 9 leaders');
    await expect(box(page, 'Recorded their DCC checklist')).toContainText('1 of 1 leader · 100%');
  });

  test('lists each root’s direct leaders in the server’s order, with no percentage', async ({
    page,
  }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSeniorPastor(page);

    await page.goto('/dashboard');

    // The Men's root first, as the server sends it, although his name sorts second.
    await expect(page.getByRole('heading', { level: 3 })).toHaveText([
      // The boxes' one heading (decision 0327).
      'Whole Church',
      'Ptr. Teodulo Villareal’s leaders',
      'Ptra. Amparo Lacson’s leaders',
      'Others',
    ]);

    const mens = page.getByRole('table', { name: 'Ptr. Teodulo Villareal’s leaders' });
    await expect(mens.getByRole('columnheader')).toHaveText([
      'Primaries',
      'Cell group recorded',
      'DCC checklist recorded',
      'Status',
    ]);

    const rows = mens.getByRole('row').filter({ has: page.getByRole('cell') });
    // First-name order (decision 0359), never sorted by a figure.
    await expect(rows.getByRole('link')).toHaveText([
      'Bernardo Abad',
      'Celestino Ocampo',
      'Dionisio Yap',
    ]);
    await expect(rows.nth(0).getByRole('cell')).toHaveText([
      'Bernardo Abad',
      '2 of 2 leaders',
      '3 of 3 leaders',
      'Completed',
    ]);
    await expect(rows.nth(1).getByRole('cell')).toHaveText([
      'Celestino Ocampo',
      '1 of 4 leaders',
      '2 of 4 leaders',
      '3 leaders still to record',
    ]);
    await expect(rows.nth(2).getByRole('cell')).toHaveText([
      'Dionisio Yap',
      '0 of 0 leaders',
      '0 of 0 leaders',
      'Nothing owed',
    ]);
    // Each name opens that leader's page, Branch having left People (decision 0364).
    await expect(rows.nth(1).getByRole('link')).toHaveAttribute(
      'href',
      '/people/3f1b7c6e-0000-4000-8000-000000000b02',
    );

    const womens = page.getByRole('table', { name: 'Ptra. Amparo Lacson’s leaders' });
    await expect(
      womens
        .getByRole('row')
        .filter({ has: page.getByRole('cell') })
        .getByRole('cell')
        .nth(3),
    ).toHaveText('1 leader still to record');

    for (const table of [mens, womens]) {
      await expect(table).not.toContainText('%');
    }
  });

  test('counts everybody in neither table on an Others line, with no link to the Cells behind', async ({
    page,
  }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSeniorPastor(page);

    await page.goto('/dashboard');

    const others = page.getByRole('heading', { level: 3, name: 'Others' }).locator('..');
    await expect(others.getByRole('term')).toHaveText([
      'Cell group recorded',
      'DCC checklist recorded',
      'Status',
    ]);
    await expect(others.getByRole('definition')).toHaveText([
      '0 of 0 leaders',
      '1 of 2 leaders',
      '1 leader still to record',
    ]);

    // Filed Reports is withdrawn for every account (decision 0340), so nothing leads there.
    await expect(page.getByRole('link', { name: 'See which Cells are behind' })).toHaveCount(0);
    await expect(page.locator('a[href^="/reports/filed"]')).toHaveCount(0);
  });

  test('keeps the boxes and says why where the server refuses the tables', async ({ page }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSeniorPastor(page, (url) => ({ ...defaultAnswer(url), tables: null, others: null }));

    await page.goto('/dashboard');

    await expect(box(page, 'Recorded their Cell group')).toContainText('6 of 10 leaders · 60%');
    await expect(page.getByText(/The leaders’ tables cannot be shown for this week/)).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Others' })).toHaveCount(0);
  });

  // WCAG 2.5.8, measured here because the accessibility sweep signs in no Senior Pastor (its
  // TARGET_EXEMPT entry for "record, recording progress" points here). Measured as that sweep
  // measures: focused, and by the label a control sits in where it has one. A phone width,
  // where the tables are cards, and a desktop one, where they are tables.
  for (const width of [390, 1280]) {
    test(`every control on Recording Progress is at least 24 by 24 at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.setFixedTime(OCTOBER_8);
      await mockSeniorPastor(page);

      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { level: 3, name: 'Others' })).toBeVisible();

      const targets = page.locator('main button, main a[href], main input, main select');
      const count = await targets.count();
      // Two tabs, Week and Month, the period before and after, and five leader names in each
      // rendering (the hidden one counted, not measured).
      expect(count).toBeGreaterThanOrEqual(16);

      const small: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const target = targets.nth(index);
        if (!(await target.isVisible())) {
          continue;
        }
        await target.focus().catch(() => {});
        const measured = await target.evaluate((node) => {
          const rect = (node.closest('label') ?? node).getBoundingClientRect();
          const text = (node.textContent ?? '').trim().slice(0, 40);
          return { width: rect.width, height: rect.height, name: `${node.tagName}: ${text}` };
        });
        if (measured.width < 24 || measured.height < 24) {
          small.push(`${measured.name} (${measured.width} by ${measured.height})`);
        }
      }

      expect(small).toEqual([]);
    });
  }
});

/**
 * The sidebar names no items until the server says which screens the account has (owner,
 * 2026-10-11). It used to show the five as a placeholder, so a Recording-only leader saw them
 * flash on a reload before their four replaced them.
 */
test('a Recording-only account never sees the five items while the server answers', async ({
  page,
}) => {
  await mockSignedIn(page);
  await mockScreens(page, 'RECORDING');
  await mockPeople(page);
  let release: () => void = () => {};
  const answered = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Registered last, so it runs first: holds `/auth/me` back, then lets the mock answer.
  await page.route('**/api/v1/auth/me', async (route) => {
    await answered;
    await route.fallback();
  });

  await page.goto('/people');
  await expect(mainNavigation(page)).toBeAttached();
  await expect(mainNavigation(page).getByRole('link')).toHaveCount(0);
  // Nor the Branch tab, which this account does not have either.
  await expect(page.getByRole('navigation', { name: 'People' })).toHaveCount(0);

  release();
  await expect(mainNavigation(page).getByRole('link')).toHaveText([
    'Record',
    'People',
    'Cells',
    'SUYNL',
  ]);
});

/**
 * A Full view leader's Recording Progress (decision 0334): the last of Record's tabs, for a
 * reader whose role reads reports over their own branch, and reading that branch.
 */
test.describe('a Full view leader’s Recording Progress (decision 0334)', () => {
  const column = (recorded: number, owed: number) => ({ recorded, owed });

  async function mockFullRecord(page: Page) {
    await page.clock.setFixedTime(new Date('2026-10-08T02:00:00Z'));
    await mockSignedIn(page);
    await mockCells(page);
    await mockCellMeetings(page);
    await mockMeetingsAwaiting(page, {});
    await mockCellReport(page);
    await mockDccReport(page);
    await mockDccEvents(page);
    await mockDccRoster(page);
    await mockAwaitingReassignment(page);
    await mockPeopleWithoutACell(page);
    await mockPendingDcc(page);
  }

  test('is the last tab, and reads the reader’s own branch', async ({ page }) => {
    await mockFullRecord(page);
    await mockGrants(page, ['reports.view_subtree']);
    const asked: URLSearchParams[] = [];
    await page.route('**/api/v1/reports/recording-status/leader?*', (route) => {
      asked.push(new URL(route.request().url()).searchParams);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          kind: 'WEEK',
          start: '2026-10-05',
          end: '2026-10-11',
          open: true,
          branch: {
            cell: { ...column(1, 2), percent: 50 },
            dcc: { ...column(1, 1), percent: 100 },
          },
          previous: {
            start: '2026-09-28',
            end: '2026-10-04',
            open: true,
            cell: column(2, 2),
            dcc: column(1, 1),
          },
          rows: [
            {
              leader: { id: PERSON_IN_SCOPE, member_id: 'M-000201', full_name: 'Ana Lim' },
              cell: column(1, 2),
              dcc: column(1, 1),
              status: { kind: 'STILL_TO_RECORD', leaders: 1 },
              opens_pending: { cell: true, dcc: true },
            },
          ],
          others: null,
        }),
      });
    });

    await page.goto('/dashboard');

    const tabs = page.getByRole('group', { name: 'Outstanding work' }).getByRole('button');
    // The three recording lists, then Recording Progress (decisions 0334 and 0381).
    await expect(tabs).toHaveCount(4);
    await expect(tabs.last()).toHaveText('Recording Progress');
    await tabs.last().click();

    // No line under the tab, and Week or Month sits in the bar with the period (owner,
    // 2026-10-18).
    await expect(page.getByText('How your 12 are recording this week.')).toHaveCount(0);
    const bar = page
      .getByRole('region', { name: 'Recording Progress' })
      .locator('div')
      .filter({ has: page.getByRole('button', { name: 'Month', exact: true }) })
      .filter({ hasText: 'Oct 2026' });
    await expect(bar.first()).toBeVisible();
    await expect(page.getByText(/^1 of 2 leaders . 50%$/)).toBeVisible();
    const table = page.getByRole('table', { name: 'My 12' });
    await expect(table.getByRole('link', { name: 'Ana Lim' })).toBeVisible();
    // The column names the table, so no title stands above it (owner, 2026-10-12).
    await expect(page.getByRole('heading', { name: 'My 12' })).toHaveCount(0);

    expect(asked[0]?.get('scope')).toBe('LEADER');
    expect(asked[0]?.get('leader_id')).toBe(SIGNED_IN_PERSON_ID);
  });

  test('opens Pending CG Records for a row’s branch from its figure, and Show everyone clears it (decision 0370)', async ({
    page,
  }) => {
    await mockFullRecord(page);
    await mockGrants(page, ['reports.view_subtree']);
    await page.route('**/api/v1/reports/recording-status/leader?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          kind: 'WEEK',
          start: '2026-10-05',
          end: '2026-10-11',
          open: true,
          branch: { cell: { ...column(1, 2), percent: 50 }, dcc: { ...column(1, 1), percent: 100 } },
          previous: {
            start: '2026-09-28',
            end: '2026-10-04',
            open: true,
            cell: column(2, 2),
            dcc: column(1, 1),
          },
          rows: [
            {
              leader: { id: PERSON_IN_SCOPE.id, member_id: 'M-000201', full_name: 'Ana Lim' },
              cell: column(1, 2),
              dcc: column(1, 1),
              status: { kind: 'STILL_TO_RECORD', leaders: 1 },
              opens_pending: { cell: true, dcc: true },
            },
            {
              // Named for the week, and moved out of the reader's branch since (decision 0370).
              leader: { id: 'c0c0c0c0-0000-4000-8000-000000000777', member_id: 'M-000777', full_name: 'Ben Uy' },
              cell: column(0, 1),
              dcc: column(0, 1),
              status: { kind: 'STILL_TO_RECORD', leaders: 1 },
              opens_pending: { cell: false, dcc: false },
            },
          ],
          others: null,
        }),
      }),
    );
    const pending: URLSearchParams[] = [];
    await page.route('**/api/v1/cells/meetings/pending*', (route) => {
      pending.push(new URL(route.request().url()).searchParams);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], next_cursor: null }),
      });
    });

    await page.goto('/dashboard?list=status');
    const table = page.getByRole('table', { name: 'My 12' });
    // Somebody in Ana's branch has not recorded their Cell group, and everybody has their DCC.
    const cellFigure = table.getByRole('button', { name: /Ana Lim’s branch in Pending CG Records/ });
    await expect(cellFigure).toHaveText('1 of 2 leaders');
    await expect(table.getByRole('button', { name: /Pending DCC Records/ })).toHaveCount(0);
    // Ben was moved out of the branch since the week, so his figures are plain text.
    await expect(table.getByRole('button', { name: /Ben Uy/ })).toHaveCount(0);
    await expect(table.getByRole('row', { name: /Ben Uy/ })).toContainText('0 of 1 leader');

    await cellFigure.click();
    await expect(page).toHaveURL(/list=behind/);
    await expect(page.getByText(/Ana Lim\s+and everyone beneath them/)).toBeVisible();
    // Drawn for the table and for the phone list; one of the two is showing.
    await expect(page.getByText('Nothing still to record in Ana Lim’s branch.').first()).toBeVisible();
    await expect.poll(() => pending.at(-1)?.get('leader_id')).toBe(PERSON_IN_SCOPE.id);

    await page.getByRole('button', { name: 'Show everyone' }).click();
    await expect(page.getByText(/and everyone beneath them/)).toHaveCount(0);
    // The whole list again, which was read before the figure was clicked.
    await expect(
      page.getByText('No Cell you oversee has a meeting still to record.').first(),
    ).toBeVisible();
    expect(pending.some((params) => !params.has('leader_id'))).toBe(true);
  });

  test('is not offered to a reader whose reports reach beyond their own branch', async ({
    page,
  }) => {
    // The shared account reads reports at Network scope, as an overseer granted one would.
    await mockFullRecord(page);

    await page.goto('/dashboard');

    const tabs = page.getByRole('group', { name: 'Outstanding work' }).getByRole('button');
    await expect(tabs).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Recording Progress' })).toHaveCount(0);
  });
});
