import { expect, test, type Page } from '@playwright/test';

import { mockAdministrator, mockPeople, mockScreens, mockSignedIn } from './mock-api';
import { mockBranchPeople, mockChurchCounts } from './mock-senior-pastor';

/**
 * People › *# of People*, in Branch's place (SKILL.md section 19, decision 0364).
 *
 * A Full view leader reads their own branch and opens a leader beneath them; the Admin reads the
 * Senior Pastors' whole-church figure; a Recording-only account is offered no such tab. Names are
 * invented (CLAUDE.md, Secrets).
 */

/** 10:00 on 8 October 2026 in Manila. */
const OCTOBER_8 = new Date('2026-10-08T02:00:00Z');
const CONSUELO = '3f1b7c6e-0000-4000-8000-000000000701';

function table(page: Page) {
  return page.getByRole('table', { name: 'Your 12' });
}

test.describe('a Full view leader’s # of People', () => {
  test('counts their own branch: the box, a row per disciple, their own row, and the total', async ({
    page,
  }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSignedIn(page);
    const asked = await mockBranchPeople(page);
    await page.goto('/people/number-of-people');

    await expect(page.getByRole('heading', { name: 'Your Disciples' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Number of People' }).locator('dl')).toHaveText(
      /People\s*42/,
    );
    const rows = table(page).locator('tbody tr');
    await expect(rows).toHaveText([
      /^Consuelo Bautista\s*14$/,
      /^Efren Dimaculangan\s*10$/,
      // A leader the reader may not open is counted and named nobody.
      /^A leader you don’t oversee\s*17$/,
      /^You\s*1$/,
      /^Total\s*42$/,
    ]);
    expect(asked[0]).toMatchObject({ period: '2026-10-01' });

    const tabs = page.getByRole('navigation', { name: 'People' });
    await expect(tabs.locator('a[aria-current="page"]')).toHaveText('# of People');
  });

  test('a name opens that leader’s count, with a way back', async ({ page }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSignedIn(page);
    const asked = await mockBranchPeople(page);
    await page.goto('/people/number-of-people');

    await table(page).getByRole('link', { name: 'Consuelo Bautista' }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]leader=${CONSUELO}`));
    await expect.poll(() => asked.some((each) => each.leader === CONSUELO)).toBe(true);
    await expect(page.getByRole('link', { name: 'Back to your disciples' })).toHaveAttribute(
      'href',
      '/people/number-of-people',
    );
  });

  test('the month arrows read the month before', async ({ page }) => {
    await page.clock.setFixedTime(OCTOBER_8);
    await mockSignedIn(page);
    const asked = await mockBranchPeople(page);
    await page.goto('/people/number-of-people');

    await page.getByRole('button', { name: 'The period before' }).click();
    await expect.poll(() => asked.some((each) => each.period === '2026-09-01')).toBe(true);
    await expect(page.getByText('as at 30 September 2026')).toBeVisible();
  });
});

test('the Admin’s # of People is the whole church, as the Senior Pastors read it', async ({ page }) => {
  await page.clock.setFixedTime(OCTOBER_8);
  await mockSignedIn(page);
  await mockAdministrator(page);
  await mockChurchCounts(page);
  await page.goto('/people/number-of-people');

  await expect(page.getByRole('heading', { name: 'Whole Church' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your Disciples' })).toHaveCount(0);
});

test('a Recording-only account is offered no # of People', async ({ page }) => {
  await mockSignedIn(page);
  await mockScreens(page, 'RECORDING');
  await mockPeople(page);
  await page.goto('/people');

  await expect(page.getByRole('link', { name: 'Number of People' })).toHaveCount(0);
});
