import { expect, test, type Page } from '@playwright/test';

import { mockCoordinator, mockSignedIn } from './mock-api';
import { mockClassGuides, mockCoordinatedClasses, mockTeacherCheck } from './mock-equipping';

/**
 * The Coordinator's *Classes* (SKILL.md section 29, decision 0501). `accessibility.spec.ts`
 * scans the screen; these cases pin where it is reached and what it says.
 *
 *   - on a laptop it is its own sidebar item, after SUYNL;
 *   - on a phone the bottom bar keeps five items: *Classes* is a tab beside SUYNL, under the
 *     item then named *Growth* (owner, 2026-11-20, options A);
 *   - a class with no Teacher says *Not named yet*, in words;
 *   - its Guides (decision 0501, point 8): how many more are needed, in words; naming one by a
 *     search with a *Choose* button; and each student's Cell leader, Guide and *Swap Guide*.
 */
async function openClasses(page: Page) {
  await mockSignedIn(page);
  await mockCoordinator(page);
  await mockCoordinatedClasses(page);
  await page.goto('/equipping/classes');
  await expect(page.getByRole('heading', { name: 'Classes', level: 1 })).toBeVisible();
}

test('on a laptop Classes is its own sidebar item, and a class with no Teacher says so', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openClasses(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Classes' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'SUYNL' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Life Class C/ })).toContainText('Not named yet');
  await expect(page.getByRole('row', { name: /Life Class A/ })).toContainText('Aurora Reyes');
});

test('on a phone the bar keeps five items, and Classes is a tab beside SUYNL under Growth', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openClasses(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Classes' })).toBeHidden();
  await expect(nav.getByRole('link', { name: 'Growth' })).toBeVisible();
  await expect(nav.getByRole('link').filter({ visible: true })).toHaveCount(5);
  const tabs = page.getByRole('navigation', { name: 'Growth' });
  await expect(tabs.getByRole('link', { name: 'Classes' })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('link', { name: 'SUYNL' })).toBeVisible();
});

test('a class short of Guides says how many more, in words', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openClasses(page);
  // Each sex said apart (section 29): Life Class A's men are guided, its one woman is not.
  await expect(page.getByRole('row', { name: /Life Class A/ })).toContainText('1 · 1 more for women');
});

test('Edit names a Guide from a search with a Choose button, and removes one', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { sent } = await mockClassGuides(page);
  await openClasses(page);
  await page.getByRole('row', { name: /Life Class A/ }).getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Life Class A' });
  const guides = dialog.getByRole('region', { name: 'Guides' });
  await expect(guides).toContainText('2 men and 1 woman enrolled');
  await expect(guides.getByText('Benjie Lacson')).toBeVisible();
  await expect(guides.getByRole('listitem').filter({ hasText: 'Rogelio Santos' })).toContainText(
    'archived, takes no new students',
  );

  await guides.getByRole('button', { name: 'Add a Guide' }).click();
  await guides.getByLabel('Add a Guide').fill('Jose');
  await guides.getByLabel('Add a Guide').press('Enter');
  await expect(guides.getByRole('status').filter({ hasText: 'found' })).toHaveText(
    '1 person found. Choose the person to add as a Guide.',
  );
  // Each person found says why they may guide (decision 0501, point 4).
  await expect(guides.getByText('Passed SOL 1', { exact: true })).toBeVisible();
  await guides.getByRole('button', { name: 'Choose Josefina Uy' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].url).toMatch(/\/classes\/[^/]+\/guides$/);
  expect(sent[0].body).toEqual({ person_id: '3f1b7c6e-0000-4000-8000-00000000a601' });

  await guides.getByRole('listitem').filter({ hasText: 'Danilo Pineda' }).getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].url).toMatch(/\/guides\/3f1b7c6e-0000-4000-8000-00000000a102\/remove$/);
});

test('Students shows each Cell leader and Guide, says No Guide yet, and swaps a Guide', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { sent } = await mockClassGuides(page);
  await openClasses(page);
  await page.getByRole('row', { name: /Life Class A/ }).getByRole('button', { name: 'Students' }).click();
  const dialog = page.getByRole('dialog', { name: 'Life Class A · students' });
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Efren Quiambao' })).toContainText(
    'Cell leader: Gilbert Manalo · Guide: Benjie Lacson',
  );
  // Nobody of her sex guides yet, so there is nobody to swap to.
  const imelda = dialog.getByRole('listitem').filter({ hasText: 'Imelda Tolentino' });
  await expect(imelda).toContainText('Cell leader: none · Guide: No Guide yet');
  await expect(imelda.getByRole('combobox')).toHaveCount(0);

  // Swap offers the other Guide of his sex who takes new students, not the archived one.
  const swap = dialog.getByLabel('Swap Guide for Hernan Ocampo');
  await expect(swap.getByRole('option')).toHaveText(['Keep Benjie Lacson', 'Danilo Pineda']);
  await swap.selectOption({ label: 'Danilo Pineda' });
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].url).toMatch(/\/enrollments\/3f1b7c6e-0000-4000-8000-00000000a302\/guide$/);
  expect(sent[0].body).toEqual({ guide_id: '3f1b7c6e-0000-4000-8000-00000000a102' });
});

test('naming a Teacher with no account warns that they cannot record, and still saves', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockClassGuides(page);
  await mockTeacherCheck(page, 'NONE');
  await openClasses(page);
  await page.getByRole('row', { name: /Life Class C/ }).getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Life Class C' });
  await dialog.getByLabel('Teacher').fill('Marcel');
  await dialog.getByLabel('Teacher').press('Enter');
  await dialog.getByRole('button', { name: /Choose Marcelino Dizon/ }).click();
  // Decision 0503, point 6: a warning, never a refusal.
  await expect(dialog.getByText('Marcelino Dizon has no account yet, so they cannot record attendance. Ask the Admin.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save Teacher' })).toBeEnabled();
});