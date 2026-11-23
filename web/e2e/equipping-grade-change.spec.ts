import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import { mockFinalGrades, mockGradeChange, mockRegistrar } from './mock-equipping';

/**
 * A lesson of a posted class changed by the Admin, and the grade worked out again (SKILL.md
 * section 29, decision 0513), as the owner chose it from screenshots: *Change…* on each row, a
 * dialog showing what the grade becomes before saving, a summary to confirm, and the history
 * kept on the row. Every name is invented.
 */

async function open(page: Page, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await mockSignedIn(page);
  await mockRegistrar(page);
  await mockFinalGrades(page, 'POSTED');
  const mocked = await mockGradeChange(page);
  await page.goto('/equipping/final-grades');
  await expect(page.getByRole('heading', { name: 'Final Grades', level: 1 })).toBeVisible();
  return mocked;
}

test('a changed grade shows its history on the row, posted then changed', async ({ page }) => {
  await open(page);
  const table = page.getByRole('table', { name: 'Final grades, Life Class A' });
  const toggle = table.getByRole('button', { name: /Changed after posting/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(table.getByText(/22 Mar · Posted · ✗ Not passed · L3 not made up\./)).toBeVisible();
  await expect(table.getByText(/Changed by Ada Reyes · L3 ✗ Absent, not made up → M made up/)).toBeVisible();
  await expect(table.getByText('Made up after posting: Watched the L3 teaching with the Teacher.')).toBeVisible();
});

test('changes a lesson in two steps, showing the new grade before saving', async ({ page }) => {
  const { sent } = await open(page);
  await page.getByRole('button', { name: 'Change Imelda Tolentino’s lessons' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change Imelda Tolentino’s lessons' });
  await expect(dialog.getByRole('button', { name: 'Review change' })).toBeDisabled();

  await dialog.getByLabel('Lesson').selectOption('7');
  await dialog.getByRole('radio', { name: 'Made up', exact: true }).check();
  await dialog.getByLabel('Made up on').fill('2027-03-24');
  await dialog.getByRole('radio', { name: 'Made up after posting' }).check();
  await dialog.getByLabel('Details (required)').fill('Watched the L7 teaching with the Teacher.');
  await expect(dialog.getByText('Grade becomes ✓ Passed')).toBeVisible();
  await expect(dialog.getByText(/Life Class goes into their Training from the school/)).toBeVisible();

  await dialog.getByRole('button', { name: 'Review change' }).click();
  const confirm = page.getByRole('dialog', { name: 'Save this change?' });
  await expect(confirm.getByText(/It cannot be undone, only changed again/)).toBeVisible();
  expect(sent).toHaveLength(0);
  await confirm.getByRole('button', { name: 'Save change' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].body).toEqual({
    lesson: 7,
    to: 'MADE_UP',
    made_up_on: '2027-03-24',
    why: 'MADE_UP_AFTER_POSTING',
    details: 'Watched the L7 teaching with the Teacher.',
    changes_seen: 0,
  });
});

test('the Registrar is offered no change', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockRegistrar(page);
  await mockFinalGrades(page, 'POSTED');
  await page.goto('/equipping/final-grades');
  await expect(page.getByText('Posted. A change now is made by the Admin, with a reason.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Change/ })).toHaveCount(0);
});

test('on a phone each card offers the change', async ({ page }) => {
  await open(page, 390);
  // *Not passed* first, as the table puts what needs a look first (decision 0508).
  await page.getByRole('button', { name: 'Change lessons…' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Change Imelda Tolentino’s lessons' })).toBeVisible();
});
