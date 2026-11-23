import { expect, test, type Page } from '@playwright/test';

import { mockCoordinator, mockSignedIn } from './mock-api';
import { ATTENDANCE_IDS, mockFinalGrades, mockRegistrar } from './mock-equipping';

/**
 * Final grades (SKILL.md section 29, decision 0501, point 16; decision 0508), the owner's version
 * B: where a class stands in three steps, grades beside the name with the reason, what needs a
 * look first, filters, and a confirmation before posting. Every name is invented.
 */

async function registrar(page: Page, phase: Parameters<typeof mockFinalGrades>[1] = 'READY') {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockRegistrar(page);
  const mocked = await mockFinalGrades(page, phase);
  await page.goto('/equipping/final-grades');
  await expect(page.getByRole('heading', { name: 'Final Grades', level: 1 })).toBeVisible();
  return mocked;
}

test('each class says where it stands, and the grades lead with what needs a look', async ({ page }) => {
  await registrar(page);
  const classes = page.getByRole('group', { name: 'Classes' });
  await expect(classes.getByRole('button', { name: /Life Class A\s*Ready to post/ })).toBeVisible();
  await expect(classes.getByRole('button', { name: /Life Class B\s*Waiting for the Coordinator/ })).toBeVisible();
  await expect(classes.getByRole('button', { name: /Life Class C\s*Posted/ })).toBeVisible();

  const table = page.getByRole('table', { name: 'Final grades, Life Class A' });
  const names = await table.getByRole('rowheader').allTextContents();
  expect(names.map((n) => n.split(' ')[0])).toEqual(['Imelda', 'Ramil', 'Nestor', 'Efren', 'Tomas']);
  await expect(table.getByRole('row', { name: /Nestor Villamor/ })).toContainText('Not yet');
  await expect(table.getByRole('row', { name: /Ramil Soriano/ })).toContainText('Joins a later class at lesson 6.');

  await page.getByRole('button', { name: 'Not yet · 1' }).click();
  await expect(table.getByRole('rowheader')).toHaveCount(1);
});

test('posting asks first, and says it is final', async ({ page }) => {
  const { sent } = await registrar(page);
  await page.getByRole('button', { name: 'Post Life Class A…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Post Life Class A?' });
  await expect(dialog).toContainText('2 passed · 2 not passed · 1 not yet.');
  await expect(dialog).toContainText('A change after posting is made by the Admin, with a reason.');
  await dialog.getByRole('button', { name: 'Post grades' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].url).toMatch(new RegExp(`/final-grades/classes/${ATTENDANCE_IDS.classId}/post$`));
});

test('a class not yet checked cannot be posted, and says who checks it', async ({ page }) => {
  await registrar(page, 'WAITING_ADMIN');
  await expect(page.getByText('The Admin checks the Coordinator’s own disciples before it can be posted.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post Life Class A…' })).toBeDisabled();
});

test('the Coordinator reads the grades, sees their disciple marked, and checks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockCoordinator(page);
  const { sent } = await mockFinalGrades(page, 'WAITING_COORDINATOR');
  await page.goto(`/equipping/classes/${ATTENDANCE_IDS.classId}/grades`);
  const table = page.getByRole('table', { name: 'Final grades, Life Class A' });
  await expect(table.getByRole('row', { name: /Ramil Soriano/ })).toContainText('Your disciple: the Admin checks');
  await page.getByRole('button', { name: 'Mark as checked' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].url).toMatch(/\/coordinate\/classes\/.*\/check$/);
});
