import { expect, test, type Page } from '@playwright/test';

import { PERSON_IN_SCOPE, SIGNED_IN_PERSON_ID, mockSignedIn } from './mock-api';
import {
  mockCellReport,
  mockCoverageByLeader,
  mockDccReport,
  mockNetworkReader,
  mockNetworkTree,
  mockPastoralPathAtRoot,
} from './mock-attendance';

async function signedInReader(page: import('@playwright/test').Page) {
  await mockSignedIn(page);
  await mockPastoralPathAtRoot(page);
  await mockNetworkTree(page);
  await mockNetworkReader(page);
}

/**
 * Where the Network screen starts (decision 0268). `accessibility.spec.ts` scans the branch
 * view; this pins what a reader outside the pastoral tree is shown instead. Invented names.
 */
test.describe('the Network screen’s starting point', () => {
  const root = (id: string, member: string, name: string, direct: number, beneath: number) => ({
    id,
    member_id: member,
    full_name: name,
    leads_anyone: direct > 0,
    direct_reports: direct,
    beneath,
  });

  test('a reader outside the tree starts at the roots, each opening its branch', async ({
    page,
  }) => {
    await signedInReader(page);

    const andres = root('3f1b7c6e-0000-4000-8000-000000000791', 'M-000002', 'Andres Villareal', 12, 40);
    const lorna = root('3f1b7c6e-0000-4000-8000-000000000792', 'M-000003', 'Lorna Villareal', 9, 30);

    // Registered after the default, so it is the one matched.
    await page.route('**/api/v1/network/my-tree*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          person: root('3f1b7c6e-0000-4000-8000-000000000790', 'M-000001', 'Carmela Ocampo', 0, 0),
          data: [],
          next_cursor: null,
          roots: [andres, lorna],
        }),
      }),
    );

    await page.goto('/network');

    await expect(page.getByRole('heading', { name: 'Network roots' })).toBeVisible();
    await expect(
      page.getByText('Figures for September 2026, a month still open.', { exact: false }).last(),
    ).toBeVisible();
    await expect(page.getByText('Nobody reports to you today.')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open Andres Villareal' })).toHaveAttribute(
      'href',
      `/network?focus=${andres.id}`,
    );
    await expect(page.getByRole('link', { name: 'Open Lorna Villareal' })).toBeVisible();
    // A root is never moved (section 5).
    await expect(page.getByRole('button', { name: /^Move/ })).toHaveCount(0);
  });

  test('a reader in the tree starts on their own branch, as before', async ({ page }) => {
    await signedInReader(page);
    await page.goto('/network');

    await expect(page.getByRole('heading', { name: 'Reports to you' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Network roots' })).toHaveCount(0);
  });
});

/**
 * The focus person's four figures, in the words of the 2026-09-25 pass over the screens.
 * The two figures still to record stay two, each named, and are never added together
 * (SKILL.md section 19).
 */
test.describe('the Network screen’s figures', () => {
  test('names the branch’s figures, and keeps DCC and Cell apart', async ({ page }) => {
    await signedInReader(page);
    await page.goto('/network');

    const cards = page
      .locator('main dl')
      .filter({ has: page.getByRole('term').filter({ hasText: 'Still to record' }) });
    await expect(cards.getByRole('term')).toHaveText([
      'Direct disciples',
      'Everyone under you',
      'Cell Leaders beneath',
      'Still to record',
    ]);
    await expect(cards.getByRole('definition')).toHaveText([
      '3',
      '9',
      '2',
      /^4\s*DCC\s*·\s*1\s*Cell$/,
    ]);

    for (const old of ['Direct reports', 'Whole branch', 'Cell leaders in branch', 'People beneath']) {
      await expect(page.getByRole('term').filter({ hasText: old })).toHaveCount(0);
    }
    await expect(page.getByText('DCC records · Cell meetings')).toHaveCount(0);
  });

  test('names the person it is looking at, on somebody else’s branch', async ({ page }) => {
    await signedInReader(page);
    await page.goto('/network?focus=3f1b7c6e-0000-4000-8000-000000000701');

    await expect(page.getByRole('term').filter({ hasText: 'Everyone under Consuelo Bautista' })).toBeVisible();
  });

  test('keeps Owes records in the address, and carries it into the next branch', async ({
    page,
  }) => {
    await signedInReader(page);
    await page.goto('/network');

    await page.getByRole('checkbox', { name: 'Owes records' }).check();
    await expect(page).toHaveURL(/owes=1/);
    await expect(page.getByRole('link', { name: /^Open / }).first()).toHaveAttribute(
      'href',
      /owes=1/,
    );

    await page.goto('/cells');
    await page.goBack();
    await expect(page.getByRole('checkbox', { name: 'Owes records' })).toBeChecked();

    await page.goBack();
    await expect(page.getByRole('checkbox', { name: 'Owes records' })).not.toBeChecked();
  });
});

/**
 * Each Still to record figure above zero links to the rows behind it in Filed reports
 * (decision 0298): DCC to DCC, Cell to Cell Groups, always for the focused person's branch
 * and the month the card names, and only for a reader holding `reports.view_subtree`. A
 * zero, a figure not yet read, and a reader without that capability keep plain text.
 *
 * `mockNetworkTree` answers every branch with 4 DCC and 1 Cell for September 2026, so a
 * case that needs another figure registers its own route after it. Invented names.
 */
test.describe('the Still to record figures link to Filed reports (decision 0298)', () => {
  /** Consuelo Bautista, a direct disciple in `mockNetworkTree`. */
  const CONSUELO = '3f1b7c6e-0000-4000-8000-000000000701';
  /** 10:00 on 20 September 2026 in Manila, so September has begun and Filed reports keeps it. */
  const NOW = new Date('2026-09-20T02:00:00Z');

  const dccLink = (page: Page) =>
    page.getByRole('link', { name: /DCC still to record: see Filed reports$/ });
  const cellLink = (page: Page) =>
    page.getByRole('link', { name: /Cell still to record: see Filed reports$/ });
  const stillToRecord = (page: Page) =>
    page
      .locator('main dl')
      .filter({ has: page.getByRole('term').filter({ hasText: 'Still to record' }) })
      .getByRole('definition')
      .last();

  /** One leader's branch figures, registered after the defaults so they win. */
  async function figuresFor(page: Page, id: string, dcc: number, cell: number) {
    await page.route(`**/api/v1/leaders/${id}/dcc-behind`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reporting_month: '2026-09-01',
          open: true,
          branch_behind: dcc,
          behind_by_child: {},
        }),
      }),
    );
    await page.route(`**/api/v1/leaders/${id}/cell-figures`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reporting_month: '2026-09-01',
          open: true,
          cell_leaders_beneath: 0,
          branch_meetings_behind: cell,
          meetings_behind_by_child: {},
        }),
      }),
    );
  }

  async function reportsReader(
    page: Page,
    reports: 'OWN_SUBTREE' | 'NETWORK' | 'WHOLE_CHURCH' = 'OWN_SUBTREE',
  ) {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockPastoralPathAtRoot(page);
    await mockNetworkTree(page);
    await mockNetworkReader(page, { reports });
  }

  test('on the reader’s own branch, each figure links to Filed reports for the reader', async ({
    page,
  }) => {
    // A whole-church reader: the one a link without the reader's own id would send to the
    // whole church (decision 0298, point 2).
    await reportsReader(page, 'WHOLE_CHURCH');
    await page.goto('/network');

    await expect(dccLink(page)).toHaveAccessibleName('4 DCC still to record: see Filed reports');
    await expect(dccLink(page)).toHaveAttribute(
      'href',
      `/reports/filed?kind=dcc&leader=${SIGNED_IN_PERSON_ID}&month=2026-09-01`,
    );
    await expect(cellLink(page)).toHaveAccessibleName('1 Cell still to record: see Filed reports');
    // Cell Groups is Filed reports' default, so the Cell link names no kind.
    await expect(cellLink(page)).toHaveAttribute(
      'href',
      `/reports/filed?leader=${SIGNED_IN_PERSON_ID}&month=2026-09-01`,
    );

    // Still two figures, each named, never added together (section 19).
    await expect(stillToRecord(page)).toHaveText(/^4\s*DCC\s*·\s*1\s*Cell$/);

    // WCAG 2.5.8. The target-size sweep's shared reader holds no figure capability, so
    // these two links are measured here or nowhere.
    for (const link of [dccLink(page), cellLink(page)]) {
      const box = await link.boundingBox();
      expect(box, 'a Still to record link has no box').not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(24);
      expect(box!.height).toBeGreaterThanOrEqual(24);
    }
  });

  test('on a focused disciple’s branch, each figure links to Filed reports for that disciple', async ({
    page,
  }) => {
    // A Network-scoped reporting grant: the links follow holding the capability at any scope.
    await reportsReader(page, 'NETWORK');
    await figuresFor(page, CONSUELO, 3, 2);
    await page.goto(`/network?focus=${CONSUELO}`);

    await expect(page.getByRole('link', { name: 'Up one level' })).toBeVisible();
    await expect(dccLink(page)).toHaveAccessibleName('3 DCC still to record: see Filed reports');
    await expect(dccLink(page)).toHaveAttribute(
      'href',
      `/reports/filed?kind=dcc&leader=${CONSUELO}&month=2026-09-01`,
    );
    await expect(cellLink(page)).toHaveAccessibleName('2 Cell still to record: see Filed reports');
    await expect(cellLink(page)).toHaveAttribute(
      'href',
      `/reports/filed?leader=${CONSUELO}&month=2026-09-01`,
    );
  });

  test('a zero stays plain text, and the other figure still links', async ({ page }) => {
    await reportsReader(page);
    await figuresFor(page, SIGNED_IN_PERSON_ID, 0, 1);
    await figuresFor(page, CONSUELO, 2, 0);

    await page.goto('/network');
    await expect(cellLink(page)).toBeVisible();
    await expect(stillToRecord(page)).toHaveText(/^0\s*DCC\s*·\s*1\s*Cell$/);
    await expect(dccLink(page)).toHaveCount(0);
    await expect(stillToRecord(page).getByRole('link')).toHaveCount(1);

    await page.goto(`/network?focus=${CONSUELO}`);
    await expect(dccLink(page)).toBeVisible();
    await expect(stillToRecord(page)).toHaveText(/^2\s*DCC\s*·\s*0\s*Cell$/);
    await expect(cellLink(page)).toHaveCount(0);
    await expect(stillToRecord(page).getByRole('link')).toHaveCount(1);
  });

  test('a figure not yet read is a dash, and not a link', async ({ page }) => {
    await reportsReader(page);

    // The DCC figure is held back until the dash has been checked.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/v1/leaders/${SIGNED_IN_PERSON_ID}/dcc-behind`, async (route) => {
      await held;
      await route.fallback();
    });

    await page.goto('/network');
    await expect(cellLink(page)).toBeVisible();
    await expect(stillToRecord(page)).toHaveText(/^—\s*DCC\s*·\s*1\s*Cell$/);
    await expect(dccLink(page)).toHaveCount(0);

    release();
    await expect(dccLink(page)).toBeVisible();
    await expect(stillToRecord(page)).toHaveText(/^4\s*DCC\s*·\s*1\s*Cell$/);
  });

  test('a reader without reports.view_subtree keeps plain figures, on any branch', async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    await signedInReader(page);

    for (const route of ['/network', `/network?focus=${CONSUELO}`]) {
      await page.goto(route);
      await expect(stillToRecord(page)).toHaveText(/^4\s*DCC\s*·\s*1\s*Cell$/);
      await expect(stillToRecord(page).getByRole('link')).toHaveCount(0);
      await expect(page.locator('main a[href^="/reports/filed"]')).toHaveCount(0);
    }
  });

  test('following a link opens Filed reports for that person, that month and those records', async ({
    page,
  }) => {
    await reportsReader(page);
    await figuresFor(page, CONSUELO, 3, 2);
    await mockCellReport(page);
    await mockDccReport(page);
    await mockCoverageByLeader(page);
    // The names Filed reports' "Figures for" line reads (components/leader-drill.tsx).
    await page.route(`**/api/v1/people/${SIGNED_IN_PERSON_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...PERSON_IN_SCOPE, id: SIGNED_IN_PERSON_ID }),
      }),
    );
    await page.route(`**/api/v1/people/${CONSUELO}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...PERSON_IN_SCOPE,
          id: CONSUELO,
          member_id: 'M-000801',
          first_name: 'Consuelo',
          middle_name: null,
          last_name: 'Bautista',
          full_name: 'Consuelo Bautista',
        }),
      }),
    );

    const asked: URL[] = [];
    page.on('request', (request) => {
      if (/\/api\/v1\/reports\/(cells|dcc)\/monthly\?/.test(request.url())) {
        asked.push(new URL(request.url()));
      }
    });
    const which = page.getByRole('group', { name: 'Which records' });

    // The reader's own Cell figure: Cell Groups, the reader's branch, September.
    await page.goto('/network');
    await cellLink(page).click();

    await expect(page).toHaveURL(`/reports/filed?leader=${SIGNED_IN_PERSON_ID}&month=2026-09-01`);
    await expect(
      page.getByText('Figures for Marilou Reyes Santos and everyone beneath them.'),
    ).toBeVisible();
    await expect(which.getByRole('button', { name: 'Cell Groups' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect.poll(() => asked.some((url) => url.pathname.endsWith('/cells/monthly'))).toBe(true);
    const cellAsked = asked.find((url) => url.pathname.endsWith('/cells/monthly'))!;
    expect(cellAsked.searchParams.get('leader_id')).toBe(SIGNED_IN_PERSON_ID);
    expect(cellAsked.searchParams.get('period')).toBe('2026-09-01');

    // A disciple's DCC figure: DCC, the disciple's branch, September.
    await page.goto(`/network?focus=${CONSUELO}`);
    await dccLink(page).click();

    await expect(page).toHaveURL(`/reports/filed?kind=dcc&leader=${CONSUELO}&month=2026-09-01`);
    await expect(
      page.getByText('Figures for Consuelo Bautista and everyone beneath them.'),
    ).toBeVisible();
    await expect(which.getByRole('button', { name: 'DCC' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => asked.some((url) => url.pathname.endsWith('/dcc/monthly'))).toBe(true);
    const dccAsked = asked.find((url) => url.pathname.endsWith('/dcc/monthly'))!;
    expect(dccAsked.searchParams.get('leader_id')).toBe(CONSUELO);
    expect(dccAsked.searchParams.get('period')).toBe('2026-09-01');
  });
});
