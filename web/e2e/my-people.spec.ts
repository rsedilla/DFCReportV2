import { expect, test, type Page } from '@playwright/test';

import { mockMyPeople, mockPeople, mockScreens, mockSignedIn } from './mock-api';
import { mockNetworkTree } from './mock-attendance';

/**
 * A leader's people two levels down, as one plain list (SKILL.md section 19, decision 0422): on
 * a second People tab for a leader without Full view, and behind a Tree / List switch in Family
 * Tree for a Full view leader. Every name here is invented.
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
    await expect(list.getByRole('heading', { name: '3 people under you' })).toBeVisible();
    await expect(list).toContainText('2 directly under you · 1 beneath them');
    const table = page.getByRole('table', { name: 'My People' });
    await expect(table.getByRole('row').nth(1)).toContainText('Arturo Villaruel');
    await expect(table.getByRole('row').nth(1)).toContainText('You');
    await expect(table.getByRole('row').nth(1)).toContainText('Youth · Fri');
    await expect(table.getByRole('row').nth(2)).toContainText('No Cell yet');
    await expect(table.getByRole('row').nth(3)).toContainText('Arturo Villaruel');
    // Plain names: nothing in the list is a link.
    await expect(list.getByRole('link')).toHaveCount(0);
  });

  test('reads as two lines a person on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await recordingLeader(page);
    await page.goto('/people/mine');

    await expect(page.getByRole('table', { name: 'My People' })).toBeHidden();
    await expect(page.getByText('Leader: You · Youth · Fri').first()).toBeVisible();
    await expect(page.getByText('Leader: Arturo Villaruel · Youth · Fri')).toBeVisible();
  });

  test('is a List view in Family Tree for a Full view leader, not a tab', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockSignedIn(page);
    await mockPeople(page);
    await mockNetworkTree(page);
    await mockMyPeople(page);
    await page.goto('/family-tree');

    await expect(
      page.getByRole('navigation', { name: 'People' }).getByRole('link', { name: 'My People' }),
    ).toHaveCount(0);
    const show = page.getByRole('group', { name: 'Show' });
    await expect(show.getByRole('button', { name: 'Tree' })).toHaveAttribute('aria-pressed', 'true');
    await show.getByRole('button', { name: 'List' }).click();
    await expect(page).toHaveURL(/view=list/);
    await expect(page.getByRole('heading', { name: '3 people under you' })).toBeVisible();

    // Its own address is the recording screens' alone.
    await page.goto('/people/mine');
    await expect(page.getByRole('heading', { name: 'This page isn’t part of your screens' })).toBeVisible();
  });
});
