import { expect, test, type Page } from '@playwright/test';

import { SIGNED_IN_PERSON_ID, mockSignedIn } from './mock-api';
import {
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
    await expect(page.getByText('You have no direct disciples today.')).toHaveCount(0);
    await expect(page.getByText(/the Network roots, the pastors at the top of each Network,/)).toBeVisible();
    // The name opens the branch; one control per job (owner's choice of 2026-10-05).
    await expect(page.getByRole('link', { name: 'Andres Villareal' })).toHaveAttribute(
      'href',
      `/network?focus=${andres.id}`,
    );
    await expect(page.getByRole('link', { name: 'Lorna Villareal' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Open / })).toHaveCount(0);
    // A root is never moved (section 5).
    await expect(page.getByRole('button', { name: /^Move/ })).toHaveCount(0);
  });

  test('a reader in the tree starts on their own branch, as before', async ({ page }) => {
    await signedInReader(page);
    await page.goto('/network');

    await expect(page.getByRole('heading', { name: 'Your direct disciples' })).toBeVisible();
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
      'Everyone beneath you',
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

  test('names what each row is behind on, in section 17’s words', async ({ page }) => {
    await signedInReader(page);
    await page.goto('/network');

    const rows = page.getByRole('table', { name: /^Direct disciples of/ });
    await expect(rows.getByRole('columnheader')).toHaveText([
      'Name',
      'Beneath',
      'DCC records behind',
      'Cell meetings behind',
      'Actions',
    ]);
  });

  test('names the person it is looking at, on somebody else’s branch', async ({ page }) => {
    await signedInReader(page);
    await page.goto('/network?focus=3f1b7c6e-0000-4000-8000-000000000701');

    await expect(page.getByRole('term').filter({ hasText: 'Everyone beneath Consuelo Bautista' })).toBeVisible();
  });

  test('keeps Only those still to record in the address, and carries it into the next branch', async ({
    page,
  }) => {
    await signedInReader(page);
    await page.goto('/network');

    await page.getByRole('checkbox', { name: 'Only those still to record' }).check();
    await expect(page).toHaveURL(/owes=1/);
    const rows = page.getByRole('table', { name: /^Direct disciples of/ });
    await expect(rows.getByRole('link').first()).toHaveAttribute(
      'href',
      /owes=1/,
    );

    await page.goto('/cells');
    await page.goBack();
    await expect(page.getByRole('checkbox', { name: 'Only those still to record' })).toBeChecked();

    await page.goBack();
    await expect(page.getByRole('checkbox', { name: 'Only those still to record' })).not.toBeChecked();
  });
});

/**
 * Each Still to record figure is a plain number (decision 0340): Filed Reports, which a figure
 * above zero used to open (decision 0298), is withdrawn for every account, so no figure links
 * anywhere, whatever reporting grant the reader holds and whichever branch is focused.
 *
 * `mockNetworkTree` answers every branch with 4 DCC and 1 Cell for September 2026, so a
 * case that needs another figure registers its own route after it. Invented names.
 */
test.describe('the Still to record figures are plain numbers (decision 0340)', () => {
  /** Consuelo Bautista, a direct disciple in `mockNetworkTree`. */
  const CONSUELO = '3f1b7c6e-0000-4000-8000-000000000701';
  /** 10:00 on 20 September 2026 in Manila, so September has begun. */
  const NOW = new Date('2026-09-20T02:00:00Z');

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
    reports: 'OWN_SUBTREE' | 'NETWORK' | 'WHOLE_CHURCH' | undefined,
  ) {
    await page.clock.setFixedTime(NOW);
    await mockSignedIn(page);
    await mockPastoralPathAtRoot(page);
    await mockNetworkTree(page);
    await mockNetworkReader(page, { reports });
  }

  for (const reports of ['WHOLE_CHURCH', 'NETWORK', 'OWN_SUBTREE', undefined] as const) {
    test(`a reader holding ${reports === undefined ? 'no reporting grant' : `reports.view_subtree at ${reports}`} reads plain figures, on any branch`, async ({
      page,
    }) => {
      await reportsReader(page, reports);
      await figuresFor(page, CONSUELO, 3, 2);

      for (const [route, figures] of [
        ['/network', /^4\s*DCC\s*·\s*1\s*Cell$/],
        [`/network?focus=${CONSUELO}`, /^3\s*DCC\s*·\s*2\s*Cell$/],
      ] as const) {
        await page.goto(route);
        // Still two figures, each named, never added together (section 19).
        await expect(stillToRecord(page)).toHaveText(figures);
        await expect(stillToRecord(page).getByRole('link')).toHaveCount(0);
        await expect(page.getByRole('link', { name: /still to record/ })).toHaveCount(0);
        await expect(page.locator('a[href^="/reports/filed"]')).toHaveCount(0);
      }
    });
  }

  test('a zero is shown as 0 beside the other figure', async ({ page }) => {
    await reportsReader(page, 'OWN_SUBTREE');
    await figuresFor(page, SIGNED_IN_PERSON_ID, 0, 1);
    await figuresFor(page, CONSUELO, 2, 0);

    await page.goto('/network');
    await expect(stillToRecord(page)).toHaveText(/^0\s*DCC\s*·\s*1\s*Cell$/);

    await page.goto(`/network?focus=${CONSUELO}`);
    await expect(stillToRecord(page)).toHaveText(/^2\s*DCC\s*·\s*0\s*Cell$/);
    await expect(stillToRecord(page).getByRole('link')).toHaveCount(0);
  });

  test('a figure not yet read is a dash', async ({ page }) => {
    await reportsReader(page, 'OWN_SUBTREE');

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
    await expect(stillToRecord(page)).toHaveText(/^—\s*DCC\s*·\s*1\s*Cell$/);

    release();
    await expect(stillToRecord(page)).toHaveText(/^4\s*DCC\s*·\s*1\s*Cell$/);
    await expect(stillToRecord(page).getByRole('link')).toHaveCount(0);
  });
});

/**
 * Checklist row perf-network-rewalk: every page of a branch walks the whole branch on the
 * server, so the screen reads up to 200 at once and shows twenty at a time from them.
 * Invented names.
 */
test.describe('Show 20 more on the Network screen', () => {
  async function branchOf(page: Page, total: number) {
    const disciples = Array.from({ length: total }, (_, index) => {
      const n = String(index + 1).padStart(3, '0');
      return {
        id: `3f1b7c6e-0000-4000-8000-000000002${n}`,
        member_id: `M-009${n}`,
        full_name: `Disciple ${n}`,
        leads_anyone: false,
        direct_reports: 0,
        beneath: 0,
      };
    });
    const asked: URL[] = [];

    // Registered after the default, so it is the one matched.
    await page.route('**/api/v1/network/my-tree*', (route) => {
      const url = new URL(route.request().url());
      asked.push(url);
      const start = Number(url.searchParams.get('cursor') ?? '0');
      const end = start + Number(url.searchParams.get('limit'));

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          person: {
            id: SIGNED_IN_PERSON_ID,
            member_id: 'M-009000',
            full_name: 'Rosalinda Quiambao',
            leads_anyone: true,
            direct_reports: total,
            beneath: total,
          },
          data: disciples.slice(start, end),
          next_cursor: end < total ? String(end) : null,
          roots: [],
        }),
      });
    });

    return asked;
  }

  test('reads up to 200 at once, and shows the next twenty without asking again', async ({
    page,
  }) => {
    await signedInReader(page);
    const asked = await branchOf(page, 45);
    await page.goto('/network');

    const more = page.getByRole('button', { name: 'Show 20 more' });
    await expect(page.getByText('Showing 20 of 45 · by name')).toBeVisible();
    await more.click();
    await expect(page.getByText('Showing 40 of 45 · by name')).toBeVisible();
    await more.click();
    await expect(page.getByText('Showing 45 of 45 · by name')).toBeVisible();
    await expect(more).toHaveCount(0);

    expect(asked).toHaveLength(1);
    expect(asked[0].searchParams.get('limit')).toBe('200');
  });

  test('asks for the next 200 only once the first 200 are on screen', async ({ page }) => {
    await signedInReader(page);
    const asked = await branchOf(page, 230);
    await page.goto('/network');

    const more = page.getByRole('button', { name: 'Show 20 more' });
    for (let shown = 40; shown <= 200; shown += 20) {
      await more.click();
      await expect(page.getByText(`Showing ${shown} of 230 · by name`)).toBeVisible();
    }
    expect(asked).toHaveLength(1);

    await more.click();
    await expect(page.getByText('Showing 220 of 230 · by name')).toBeVisible();
    await more.click();
    await expect(page.getByText('Showing 230 of 230 · by name')).toBeVisible();
    await expect(more).toHaveCount(0);
    expect(asked.map((url) => url.searchParams.get('cursor'))).toEqual([null, '200']);
  });
});