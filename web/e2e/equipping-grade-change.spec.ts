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
  // From A to Z by last name (decision 0515): Tomas Aquino's card is first; the dialog's title
  // reads the name as everywhere else.
  await page.getByRole('button', { name: 'Change lessons…' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Change Tomas Aquino’s lessons' })).toBeVisible();
});

test('says an Encounter changed after posting before the grade, and what a reopening does (points 10 and 14)', async ({
  page,
}) => {
  await open(page);
  await page.route('**/api/v1/equipping/final-grades/grades/*/change-preview?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        lesson: 7,
        sign_before: 'ABSENT',
        made_up_on_before: null,
        grade_before: 'NOT_PASSED',
        reason_before: 'L7 not made up.',
        grade_after: 'NOT_YET',
        reason_after: 'Encounter not attended. Passes after a later one.',
        joins_at_lesson_6_after: false,
        training: null,
        encounter_change: { before: 'CAME', now: 'MISSED' },
        enrollment: 'REOPENS',
      }),
    }),
  );
  await page.getByRole('button', { name: 'Change Imelda Tolentino’s lessons' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change Imelda Tolentino’s lessons' });
  await dialog.getByLabel('Lesson').selectOption('7');
  await dialog.getByRole('radio', { name: 'Made up', exact: true }).check();
  await dialog.getByLabel('Made up on').fill('2027-03-24');
  await dialog.getByRole('radio', { name: 'Made up after posting' }).check();
  await dialog.getByLabel('Details (required)').fill('Watched the L7 teaching with the Teacher.');
  const note = dialog.getByText(/Their Encounter changed after posting\. It read ✓ Came; it now reads ✗ Did not attend\./);
  await expect(note).toBeVisible();
  await expect(dialog.getByText('Grade becomes … Not yet')).toBeVisible();
  // The cause is read before the grade it explains.
  const noteBox = await note.boundingBox();
  const gradeBox = await dialog.getByText('Grade becomes … Not yet').boundingBox();
  expect(noteBox!.y).toBeLessThan(gradeBox!.y);
  await expect(
    dialog.getByText('Their Life Class enrollment is opened again, and they are listed for the next Encounter.'),
  ).toBeVisible();

  await dialog.getByRole('button', { name: 'Review change' }).click();
  const confirm = page.getByRole('dialog', { name: 'Save this change?' });
  await expect(confirm.getByText('Encounter, changed after posting: ✓ Came → ✗ Did not attend')).toBeVisible();
  await expect(
    confirm.getByText('Their Life Class enrollment is opened again, and they are listed for the next Encounter.'),
  ).toBeVisible();
});

test('offers no Absent for a lesson kept from an earlier term (point 12)', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Change Efren Quiambao’s lessons' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change Efren Quiambao’s lessons' });
  const lesson = dialog.getByLabel('Lesson');
  await expect(lesson.locator('option', { hasText: 'L1 ·' })).toHaveText(/in Life Class B/);
  await lesson.selectOption('1');
  await expect(dialog.getByRole('radio', { name: 'Came', exact: true })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Made up', exact: true })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Absent', exact: true })).toHaveCount(0);
  // A lesson of this class still offers all three.
  await lesson.selectOption('7');
  await expect(dialog.getByRole('radio', { name: 'Absent', exact: true })).toBeVisible();
});
