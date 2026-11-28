import { expect, test, type Page } from '@playwright/test';

import { mockCoordinator, mockSignedIn } from './mock-api';
import { ATTENDANCE_IDS, mockFinalGrades, mockRegistrar, mockSolFinalGrades } from './mock-equipping';

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

test('each class says where it stands, and the grades run from A to Z by last name', async ({ page }) => {
  await registrar(page);
  const classes = page.getByRole('group', { name: 'Classes' });
  await expect(classes.getByRole('button', { name: /Life Class A\s*Ready to post/ })).toBeVisible();
  await expect(classes.getByRole('button', { name: /Life Class B\s*Waiting for the Coordinator/ })).toBeVisible();
  await expect(classes.getByRole('button', { name: /Life Class C\s*Posted/ })).toBeVisible();

  const table = page.getByRole('table', { name: 'Final grades, Life Class A' });
  const names = await table.getByRole('rowheader').allTextContents();
  // Straight from A to Z by last name, each name last name first (decision 0515).
  expect(names.map((n) => n.split(',')[0])).toEqual(['Aquino', 'Quiambao', 'Soriano', 'Tolentino', 'Villamor']);
  expect(names[0]).toBe('Aquino, Tomas');
  await expect(table.getByRole('row', { name: /Villamor, Nestor/ })).toContainText('Not yet');
  await expect(table.getByRole('row', { name: /Soriano, Ramil/ })).toContainText('Joins a later class at lesson 6.');

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
  await expect(table.getByRole('row', { name: /Soriano, Ramil/ })).toContainText('Your disciple: the Admin checks');
  await page.getByRole('button', { name: 'Mark as checked' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].url).toMatch(/\/coordinate\/classes\/.*\/check$/);
});

test('SOL 1 grades show the five checks beside the grade, with no Not yet (decision 0514)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockRegistrar(page);
  await mockFinalGrades(page, 'READY');
  const { sent } = await mockSolFinalGrades(page);
  await page.goto('/equipping/final-grades');
  await page.getByRole('button', { name: /SOL 1/ }).first().click();
  const table = page.getByRole('table', { name: 'Final grades, SOL 1 A' });
  await expect(table.getByRole('columnheader')).toHaveText([
    'Student',
    'Grade',
    'Why',
    'Attendance',
    'Verses',
    'Devotionals',
    'Quiz',
    'Book',
  ]);
  const nestor = table.getByRole('row', { name: /Villamor, Nestor/ });
  await expect(nestor).toContainText('L7 devotional and the book missing.');
  await expect(nestor).toContainText('10 of 10 · 1 made up');
  await expect(nestor.getByRole('cell', { name: '9 of 10' })).toHaveClass(/text-field-invalid/);
  await expect(table.getByRole('row', { name: /Soriano, Ramil/ })).toContainText('4 absences');
  await expect(table.getByRole('row', { name: /Tolentino, Imelda/ })).toContainText('65% · 3 tries');
  await expect(page.getByRole('button', { name: /^Not yet/ })).toHaveCount(0);
  await expect(page.getByText('The lesson by lesson register is on the Teacher’s page.')).toBeVisible();

  await page.getByRole('button', { name: 'Post SOL 1 A…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Post SOL 1 A?' });
  await expect(dialog).toContainText('2 passed · 3 not passed.');
  await expect(dialog).not.toContainText('Encounter');
  await dialog.getByRole('button', { name: 'Post grades' }).click();
  await expect.poll(() => sent.length).toBe(1);
});

test('the Admin changes a SOL record after posting, recorded wrongly only (decision 0514)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockRegistrar(page);
  await mockFinalGrades(page, 'POSTED');
  const { sent } = await mockSolFinalGrades(page, { posted: true });
  await page.goto('/equipping/final-grades');
  await page.getByRole('button', { name: /SOL 1/ }).first().click();
  await page.getByRole('button', { name: 'Change Nestor Villamor’s record' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change Nestor Villamor’s record' });
  await dialog.getByLabel('What to change').selectOption('DEVOTIONAL');
  await dialog.getByLabel('Lesson').selectOption('7');
  await expect(dialog.getByLabel('Lesson')).toContainText('L7');
  await dialog.getByRole('radio', { name: 'Handed in', exact: true }).check();
  await dialog.getByLabel('Handed in on').fill('2027-01-11');
  // One reason only: what was still owed at posting is a retake (owner, 2026-11-26).
  await expect(dialog.getByRole('radio')).toHaveCount(3);
  await expect(dialog.getByRole('radio', { name: 'Recorded wrongly' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /after posting/ })).toHaveCount(0);
  await dialog.getByLabel('Details (required)').fill('Handed in at L7 itself; the Teacher missed the tick.');
  await expect(dialog.getByText('Grade stays ✗ Not passed')).toBeVisible();
  await dialog.getByRole('button', { name: 'Review change' }).click();
  const confirm = page.getByRole('dialog', { name: 'Save this change?' });
  await expect(confirm).toContainText('L7 devotional: not handed in → handed in');
  await confirm.getByRole('button', { name: 'Save change' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].body).toEqual({
    item: 'DEVOTIONAL',
    lesson: 7,
    handed_in: true,
    brought_on: '2027-01-11',
    why: 'RECORDED_WRONGLY',
    details: 'Handed in at L7 itself; the Teacher missed the tick.',
    changes_seen: 0,
  });
});
