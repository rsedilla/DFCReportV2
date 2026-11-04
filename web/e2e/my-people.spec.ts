import { expect, test, type Page } from '@playwright/test';

import { mockMyPeople, mockPeople, mockScreens, mockSignedIn } from './mock-api';
import { mockNetworkTree } from './mock-attendance';

/**
 * A leader's people as one plain list (SKILL.md section 19, decisions 0422 and 0437): every level
 * on a second People tab for a leader without Full view, and two levels behind a Tree / List
 * switch in Family Tree for a Full view leader, each saying how deep it goes. Every name here is
 * invented.
 */

async function recordingLeader(page: Page) {
  await mockSignedIn(page);
  await mockScreens(page, 'RECORDING');
  await mockPeople(page);
  await mockMyPeople(page);
}

test.describe('My People', () => {
  test('is a second People tab for a leader without Full view, with the count and a plain list', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await recordingLeader(page);
    await page.goto('/people');

    const tabs = page.getByRole('navigation', { name: 'People' });
    await expect(tabs.getByRole('link')).toHaveText(['Add People', 'My People']);
    await tabs.getByRole('link', { name: 'My People' }).click();
    await expect(page).toHaveURL(/\/people\/mine$/);

    const list = page.getByRole('region', { name: 'My People' });
    await expect(list.getByRole('heading', { name: '4 people in your care' })).toBeVisible();
    await expect(list).toContainText('Your 12, their 12 and everyone after them');
    await expect(list).toContainText('Pray for more workers in His harvest.');
    const table = page.getByRole('table', { name: 'My People' });
    await expect(table.getByRole('row').nth(1)).toContainText('Arturo Villaruel');
    await expect(table.getByRole('row').nth(1)).toContainText('You');
    // Who leads the Cell, by first name (decision 0437).
    await expect(table.getByRole('row').nth(1)).toContainText('Youth · Fri, led by Arturo');
    await expect(table.getByRole('row').nth(2)).toContainText('No Cell yet');
    await expect(table.getByRole('row').nth(3)).toContainText('Arturo Villaruel');
    // Plain names: nothing in the list is a link.
    await expect(list.getByRole('link')).toHaveCount(0);
  });

  test('reads as a leader line and a Cell Group line on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await recordingLeader(page);
    await page.goto('/people/mine');

    await expect(page.getByRole('table', { name: 'My People' })).toBeHidden();
    const rows = page.getByRole('region', { name: 'My People' }).getByRole('listitem');
    // The leader by full name, the Cell's leader by first name (decision 0437).
    await expect(rows.nth(0)).toContainText('Leader: You');
    await expect(rows.nth(0)).toContainText('Cell Group: Youth · Fri, led by Arturo');
    await expect(rows.nth(1)).toContainText('Cell Group: none yet');
    await expect(rows.nth(2)).toContainText('Leader: Arturo Villaruel');
    await expect(rows.nth(2)).toContainText('Cell Group: Youth · Fri, led by Arturo');
    // A Cell the reader leads says so, rather than naming them.
    await expect(rows.nth(3)).toContainText('Cell Group: Couple · Sun, led by you');
  });

  test('is a List view in Family Tree for a Full view leader, not a tab', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSignedIn(page);
    await mockPeople(page);
    await mockNetworkTree(page);
    await mockMyPeople(page, false);
    await page.goto('/family-tree');

    await expect(
      page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: 'My People' }),
    ).toHaveCount(0);
    const show = page.getByRole('group', { name: 'Show' });
    await expect(show.getByRole('button', { name: 'Tree' })).toHaveAttribute('aria-pressed', 'true');
    await show.getByRole('button', { name: 'List' }).click();
    await expect(page).toHaveURL(/view=list/);
    await expect(page.getByRole('heading', { name: '4 people in your care' })).toBeVisible();
    // Two levels here, and it says so (decision 0437).
    await expect(page.getByText('Your 12 and their 12 · Tree shows every level')).toBeVisible();

    // Its own address is the recording screens' alone.
    await page.goto('/people/mine');
    await expect(page.getByRole('heading', { name: 'This page isn’t part of your screens' })).toBeVisible();
  });
});
