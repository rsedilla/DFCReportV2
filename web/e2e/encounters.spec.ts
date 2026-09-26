import { expect, test, type Page } from '@playwright/test';

import { mockAdministrator, mockSignedIn } from './mock-api';
import {
  ENCOUNTER_DECEMBER,
  PARTY_TOO_LATE,
  mockEncounterSeasons,
  mockSuynl,
  mockTraining,
} from './mock-growth';

/**
 * The Encounter seasons (SKILL.md section 28, decision 0296), as the two screens show them:
 * the list at `/growth/training/encounters`, where an administrator keeps them, and the SUYNL
 * report's Next Encounter card, which only reads the next.
 *
 * What is pinned:
 *
 *   - a Whole Church `settings.manage` holder is offered Edit and Add, and saves through
 *     POST and PATCH with an `Idempotency-Key`; anyone else reads the list and is told only
 *     an administrator may change it;
 *   - each reader is shown the half the API answers (the owner's ruling relayed on
 *     2026-09-26): both, their own Network's, or neither;
 *   - the report shows the first season whose later weekend, of those shown, has not ended.
 *
 * The API decides every one of these (section 1, principle 4). These pin that the screens
 * render what it answers rather than second-guessing it.
 */

/** 10:00 in Manila on the day given. */
function at(day: string): Date {
  return new Date(`${day}T02:00:00Z`);
}

/** The season list's own region. */
const list = (page: Page) => page.getByRole('region', { name: 'Encounter seasons' });

/** The SUYNL report's Next Encounter card. */
const card = (page: Page) => page.getByRole('region', { name: /^Next Encounter/ });

test.describe('the Encounter seasons page', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(at('2026-09-26'));
    await mockSignedIn(page);
  });

  test('an administrator sees every date, an Edit per season and Add', async ({ page }) => {
    await mockAdministrator(page);
    await mockEncounterSeasons(page);
    await page.goto('/growth/training/encounters');

    const table = list(page).getByRole('table', { name: 'Encounter seasons' });
    await expect(table.getByRole('columnheader')).toHaveText([
      'Season',
      'Men’s LC Party',
      'Men’s Encounter',
      'Women’s LC Party',
      'Women’s Encounter',
      '',
    ]);
    const rows = table.getByRole('row');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(1).getByRole('cell')).toHaveText([
      'April 2026',
      '27 Feb 2026',
      '3 Apr – 5 Apr 2026',
      '6 Mar 2026',
      '10 Apr – 12 Apr 2026',
      'Edit April 2026',
    ]);
    await expect(rows.nth(3).getByRole('cell').first()).toHaveText('December 2026');

    await expect(list(page).getByRole('button', { name: /^Edit/ })).toHaveCount(3);
    await expect(list(page).getByRole('button', { name: 'Edit December 2026' })).toBeVisible();
    await expect(list(page).getByRole('button', { name: 'Add an Encounter season' })).toBeVisible();
    await expect(page.getByText('Only an administrator may add or change these dates.')).toHaveCount(
      0,
    );
  });

  test('adding a season shows both halves with their hints, and saves with a key', async ({
    page,
  }) => {
    await mockAdministrator(page);
    const traffic = await mockEncounterSeasons(page);
    await page.goto('/growth/training/encounters');

    await list(page).getByRole('button', { name: 'Add an Encounter season' }).click();

    const men = page.getByRole('group', { name: 'Men', exact: true });
    const women = page.getByRole('group', { name: 'Women', exact: true });
    await expect(men.getByText('Men only.')).toBeVisible();
    await expect(women.getByText('Women only. Usually a week apart from the men’s.')).toBeVisible();
    await expect(
      men.getByText('At least 5 weeks before the weekend; left empty, exactly 5.'),
    ).toBeVisible();
    await expect(page.getByText('Enter the day each weekend starts.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

    // Each field is named by its label alone, and its hint is its description.
    await expect(
      men.getByLabel('Men’s Encounter starts', { exact: true }),
    ).toHaveAccessibleDescription('Men only.');
    await expect(
      women.getByLabel('Women’s Encounter starts', { exact: true }),
    ).toHaveAccessibleDescription('Women only. Usually a week apart from the men’s.');
    await expect(men.getByLabel('Men’s LC Party', { exact: true })).toHaveAccessibleDescription(
      'At least 5 weeks before the weekend; left empty, exactly 5.',
    );

    await men.getByLabel('Men’s Encounter starts', { exact: true }).fill('2027-04-02');
    // The hint names the default once the weekend is known: five weeks before it.
    await expect(
      men.getByText('At least 5 weeks before the weekend; left empty, exactly 5 (26 Feb 2027).'),
    ).toBeVisible();
    await expect(men.getByLabel('Men’s LC Party', { exact: true })).toHaveAccessibleDescription(
      'At least 5 weeks before the weekend; left empty, exactly 5 (26 Feb 2027).',
    );
    await women.getByLabel('Women’s Encounter starts', { exact: true }).fill('2027-04-09');
    await expect(
      women.getByText('At least 5 weeks before the weekend; left empty, exactly 5 (5 Mar 2027).'),
    ).toBeVisible();
    await expect(page.getByText('Enter the day each weekend starts.')).toHaveCount(0);

    const readsBefore = traffic.reads;
    await page.getByRole('button', { name: 'Save' }).click();

    await expect.poll(() => traffic.writes.length).toBe(1);
    const [write] = traffic.writes;
    expect(write.method).toBe('POST');
    expect(write.path).toBe('/api/v1/encounter-seasons');
    // An LC Party left empty is left out, for the API to set five weeks before.
    expect(write.body).toEqual({ mens_encounter_on: '2027-04-02', womens_encounter_on: '2027-04-09' });
    expect(write.key).toMatch(/^[0-9a-f-]{36}$/);

    // Saved: the form closes and the list is read again.
    await expect(page.getByRole('group', { name: 'Men', exact: true })).toHaveCount(0);
    await expect.poll(() => traffic.reads).toBeGreaterThan(readsBefore);
  });

  test('editing a season sends all four dates to that season with a key', async ({ page }) => {
    await mockAdministrator(page);
    const traffic = await mockEncounterSeasons(page);
    await page.goto('/growth/training/encounters');

    await list(page).getByRole('button', { name: 'Edit December 2026' }).click();

    const men = page.getByRole('group', { name: 'Men', exact: true });
    const women = page.getByRole('group', { name: 'Women', exact: true });
    await expect(men.getByLabel('Men’s LC Party', { exact: true })).toHaveValue(
      ENCOUNTER_DECEMBER.mens_lc_party_on,
    );
    await expect(men.getByLabel('Men’s Encounter starts', { exact: true })).toHaveValue(
      ENCOUNTER_DECEMBER.mens_encounter_on,
    );
    await expect(women.getByLabel('Women’s LC Party', { exact: true })).toHaveValue(
      ENCOUNTER_DECEMBER.womens_lc_party_on,
    );
    await expect(women.getByLabel('Women’s Encounter starts', { exact: true })).toHaveValue(
      ENCOUNTER_DECEMBER.womens_encounter_on,
    );

    await men.getByLabel('Men’s Encounter starts', { exact: true }).fill('2026-12-05');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect.poll(() => traffic.writes.length).toBe(1);
    const [write] = traffic.writes;
    expect(write.method).toBe('PATCH');
    expect(write.path).toBe(`/api/v1/encounter-seasons/${ENCOUNTER_DECEMBER.id}`);
    expect(write.body).toEqual({
      mens_encounter_on: '2026-12-05',
      womens_encounter_on: ENCOUNTER_DECEMBER.womens_encounter_on,
      mens_lc_party_on: ENCOUNTER_DECEMBER.mens_lc_party_on,
      womens_lc_party_on: ENCOUNTER_DECEMBER.womens_lc_party_on,
    });
    expect(write.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('a save the API refuses shows its message and keeps the form', async ({ page }) => {
    await mockAdministrator(page);
    const traffic = await mockEncounterSeasons(page, { outcome: 'refused' });
    await page.goto('/growth/training/encounters');

    await list(page).getByRole('button', { name: 'Add an Encounter season' }).click();
    const men = page.getByRole('group', { name: 'Men', exact: true });
    await men.getByLabel('Men’s LC Party', { exact: true }).fill('2027-03-01');
    await men.getByLabel('Men’s Encounter starts', { exact: true }).fill('2027-04-02');
    await page
      .getByRole('group', { name: 'Women', exact: true })
      .getByLabel('Women’s Encounter starts', { exact: true })
      .fill('2027-04-09');
    await page.getByRole('button', { name: 'Save' }).click();

    // The list's own failure notice is an empty live region until the list fails.
    const refusal = list(page).getByRole('alert').filter({ hasText: /\S/ });
    await expect(refusal).toContainText(PARTY_TOO_LATE);
    await expect(men.getByLabel('Men’s LC Party', { exact: true })).toHaveValue('2027-03-01');
    expect(traffic.writes).toHaveLength(1);
    expect(traffic.writes[0].body).toMatchObject({ mens_lc_party_on: '2027-03-01' });

    // A retry of the same body keeps its key, so a lost response is replayed, not doubled.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => traffic.writes.length).toBe(2);
    expect(traffic.writes[1].key).toBe(traffic.writes[0].key);
  });

  test('anyone else reads the list, is told who may change it, and is offered nothing', async ({
    page,
  }) => {
    const traffic = await mockEncounterSeasons(page, { shows: 'MENS' });
    await page.goto('/growth/training/encounters');

    await expect(page.getByText('Only an administrator may add or change these dates.')).toBeVisible();
    const table = list(page).getByRole('table', { name: 'Encounter seasons' });
    // Their own Network's half, and no column for the other.
    await expect(table.getByRole('columnheader')).toHaveText([
      'Season',
      'Men’s LC Party',
      'Men’s Encounter',
    ]);
    await expect(table.getByRole('row').nth(2).getByRole('cell')).toHaveText([
      'August 2026',
      '3 Jul 2026',
      '7 Aug – 9 Aug 2026',
    ]);
    await expect(page.locator('main').getByRole('button')).toHaveCount(0);
    await expect(page.locator('main input')).toHaveCount(0);
    expect(traffic.writes).toHaveLength(0);
  });

  test("a Women's Network reader sees the Women's columns alone", async ({ page }) => {
    await mockEncounterSeasons(page, { shows: 'WOMENS' });
    await page.goto('/growth/training/encounters');

    const table = list(page).getByRole('table', { name: 'Encounter seasons' });
    await expect(table.getByRole('columnheader')).toHaveText([
      'Season',
      'Women’s LC Party',
      'Women’s Encounter',
    ]);
    await expect(table.getByRole('row').nth(2).getByRole('cell')).toHaveText([
      'August 2026',
      '10 Jul 2026',
      '14 Aug – 16 Aug 2026',
    ]);
  });

  test('a reader in no Network is told so, and shown no table', async ({ page }) => {
    await mockEncounterSeasons(page, { shows: 'NEITHER' });
    await page.goto('/growth/training/encounters');

    await expect(
      list(page).getByText('You are in no Network, so no Encounter weekend is shown.'),
    ).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('says so when no season has been set', async ({ page }) => {
    await mockEncounterSeasons(page, { seasons: [] });
    await page.goto('/growth/training/encounters');

    await expect(list(page).getByText('No Encounter season has been set yet.')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('sits under Growth, Training marked current, and leads back to Training', async ({
    page,
  }) => {
    await mockEncounterSeasons(page);
    await page.goto('/growth/training/encounters');

    await expect(page.getByRole('heading', { name: 'Growth', level: 1 })).toBeVisible();
    await expect(page.getByText('The Encounter God Weekends, set by an administrator.')).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Growth' });
    await expect(tabs.getByRole('link')).toHaveText(['SUYNL', 'Training', 'Conquest']);
    await expect(tabs.locator('a[aria-current="page"]')).toHaveText('Training');
    // Nothing under Reports changes a record (decision 0296), so the editor is not a report.
    await expect(page.getByRole('navigation', { name: 'Which report' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to SUYNL' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to Training' })).toHaveAttribute(
      'href',
      '/growth/training',
    );
  });

  test('is reached from the Growth Training tab', async ({ page }) => {
    await mockTraining(page);
    await mockEncounterSeasons(page);
    await page.goto('/growth/training');

    const link = page.getByRole('link', { name: 'Encounter seasons', exact: true });
    await expect(link).toHaveAttribute('href', '/growth/training/encounters');
    await link.click();
    await expect(page).toHaveURL(/\/growth\/training\/encounters$/);
    await expect(page.getByRole('table', { name: 'Encounter seasons' })).toBeVisible();
  });
});

test.describe('the SUYNL report’s Next Encounter', () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedIn(page);
    await mockSuynl(page);
  });

  test('shows the next season with both LC Parties and weekends to an administrator', async ({
    page,
  }) => {
    await page.clock.setFixedTime(at('2026-09-26'));
    await mockAdministrator(page);
    await mockEncounterSeasons(page);
    await page.goto('/reports/suynl');

    const next = card(page);
    await expect(next.getByRole('heading')).toHaveText('Next Encounter · December 2026');
    await expect(next.getByRole('term')).toHaveText(['Men', 'Women']);
    await expect(next.getByRole('definition')).toHaveText([
      'LC Party 30 Oct 2026',
      'Encounter 4 Dec – 6 Dec 2026',
      'LC Party 6 Nov 2026',
      'Encounter 11 Dec – 13 Dec 2026',
    ]);
    await expect(next.getByRole('link')).toHaveText('Encounter seasons: add or change dates');
    await expect(next.getByRole('link')).toHaveAttribute('href', '/growth/training/encounters');
  });

  test("shows a Men's Network reader the Men's half alone, and the plain link", async ({ page }) => {
    await page.clock.setFixedTime(at('2026-09-26'));
    await mockEncounterSeasons(page, { shows: 'MENS' });
    await page.goto('/reports/suynl');

    const next = card(page);
    await expect(next.getByRole('heading')).toHaveText('Next Encounter · December 2026');
    await expect(next.getByRole('term')).toHaveText(['Men']);
    await expect(next.getByRole('definition')).toHaveText([
      'LC Party 30 Oct 2026',
      'Encounter 4 Dec – 6 Dec 2026',
    ]);
    await expect(next.getByRole('link')).toHaveText('Every Encounter season');
    await expect(next.getByRole('link')).toHaveAttribute('href', '/growth/training/encounters');
  });

  test("shows a Women's Network reader the Women's half alone", async ({ page }) => {
    await page.clock.setFixedTime(at('2026-09-26'));
    await mockEncounterSeasons(page, { shows: 'WOMENS' });
    await page.goto('/reports/suynl');

    const next = card(page);
    await expect(next.getByRole('term')).toHaveText(['Women']);
    await expect(next.getByRole('definition')).toHaveText([
      'LC Party 6 Nov 2026',
      'Encounter 11 Dec – 13 Dec 2026',
    ]);
  });

  test('tells a reader in no Network that no weekend is shown', async ({ page }) => {
    await page.clock.setFixedTime(at('2026-09-26'));
    await mockEncounterSeasons(page, { shows: 'NEITHER' });
    await page.goto('/reports/suynl');

    const next = card(page);
    await expect(next.getByRole('heading')).toHaveText('Next Encounter');
    await expect(
      next.getByText('You are in no Network, so no Encounter weekend is shown.'),
    ).toBeVisible();
    await expect(next.getByRole('term')).toHaveCount(0);
  });

  test('says so when no season has been set, to an administrator and to anyone else', async ({
    page,
  }) => {
    await page.clock.setFixedTime(at('2026-09-26'));
    await mockEncounterSeasons(page, { seasons: [] });
    await page.goto('/reports/suynl');

    await expect(card(page).getByText('No Encounter season has been set yet.')).toBeVisible();
    await expect(card(page).getByRole('link')).toHaveText('Every Encounter season');

    await mockAdministrator(page);
    await page.reload();
    await expect(card(page).getByText('No Encounter season has been set yet.')).toBeVisible();
    await expect(card(page).getByRole('link')).toHaveText('Encounter seasons: add or change dates');
  });

  test('says no season is set once the last recorded one has ended', async ({ page }) => {
    await page.clock.setFixedTime(at('2026-12-14'));
    await mockEncounterSeasons(page);
    await page.goto('/reports/suynl');

    await expect(card(page).getByText('No Encounter season has been set yet.')).toBeVisible();
  });

  // The first season whose later weekend, of those shown, has not ended. August's Men's weekend
  // runs 7 to 9 August and its Women's 14 to 16 August.
  for (const { today, shows, expected } of [
    { today: '2026-08-16', shows: 'BOTH', expected: 'August 2026' },
    { today: '2026-08-17', shows: 'BOTH', expected: 'December 2026' },
    { today: '2026-08-12', shows: 'BOTH', expected: 'August 2026' },
    { today: '2026-08-09', shows: 'MENS', expected: 'August 2026' },
    { today: '2026-08-10', shows: 'MENS', expected: 'December 2026' },
    { today: '2026-08-12', shows: 'WOMENS', expected: 'August 2026' },
  ] as const) {
    test(`on ${today}, a reader shown ${shows} is shown ${expected} next`, async ({ page }) => {
      await page.clock.setFixedTime(at(today));
      await mockEncounterSeasons(page, { shows });
      await page.goto('/reports/suynl');

      await expect(card(page).getByRole('heading')).toHaveText(`Next Encounter · ${expected}`);
    });
  }

  test('changes nothing itself: the list is its own page', async ({ page }) => {
    await page.clock.setFixedTime(at('2026-09-26'));
    await mockAdministrator(page);
    const traffic = await mockEncounterSeasons(page);
    await page.goto('/reports/suynl');

    await expect(card(page).getByRole('heading')).toHaveText('Next Encounter · December 2026');
    await expect(page.locator('main').getByRole('button')).toHaveCount(0);
    await expect(page.locator('main input')).toHaveCount(0);
    expect(traffic.writes).toHaveLength(0);
  });
});

/**
 * WCAG 2.5.8 on the administrator's states, which `accessibility.spec.ts`'s sweep cannot
 * reach because it signs in one account that is no administrator; that file's
 * `TARGET_EXEMPT` names this test as where they are measured. The measurement is the sweep's
 * own: every visible control in `main`, focused, with a wrapping `<label>` taken as the
 * target, at least 24 by 24.
 */
test('every target an administrator is offered is at least 24px', async ({ page }) => {
  await page.clock.setFixedTime(at('2026-09-26'));
  await mockSignedIn(page);
  await mockAdministrator(page);
  await mockEncounterSeasons(page);
  await page.goto('/growth/training/encounters');
  await expect(page.getByRole('button', { name: 'Edit December 2026' })).toBeVisible();

  const measure = async (state: string, minimum: number) => {
    const targets = page.locator('main button, main a[href], main input, main select, main textarea');
    const count = await targets.count();
    expect(count, `${state} renders fewer targets than it owns`).toBeGreaterThanOrEqual(minimum);

    for (let index = 0; index < count; index += 1) {
      const target = targets.nth(index);
      if (!(await target.isVisible())) continue;
      await target.focus().catch(() => {});
      const box = await target.evaluate((node) => {
        const rect = (node.closest('label') ?? node).getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      const text = await target.evaluate((node) => (node.textContent ?? '').trim().slice(0, 40));
      expect(box.width, `${state}: "${text}" is ${box.width}px wide`).toBeGreaterThanOrEqual(24);
      expect(box.height, `${state}: "${text}" is ${box.height}px tall`).toBeGreaterThanOrEqual(24);
    }
  };

  // The three Growth tabs, Back to Training, three Edit buttons and Add: eight.
  await measure('the list', 8);

  // Add opens the form: the four date inputs, Save and Cancel in place of Add.
  await page.getByRole('button', { name: 'Add an Encounter season' }).click();
  await expect(page.getByRole('group', { name: 'Women', exact: true })).toBeVisible();
  await measure('the form', 13);
});
