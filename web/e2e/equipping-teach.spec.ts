import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import { ATTENDANCE_IDS, mockClassAttendance, mockMyClasses, mockTeacher } from './mock-equipping';

/**
 * A Teacher's and a Guide's *Equipping* (SKILL.md section 29, decisions 0501 and 0503).
 * `accessibility.spec.ts` scans both screens; these cases pin where they are reached and what
 * they send.
 *
 *   - on the recording screens *Equipping* is an item of its own, and for a Full view leader on a
 *     phone a tab of *Growth* beside *SUYNL*, the bar keeping five items;
 *   - the classes are grouped *Classes you teach*, then *Classes you guide*;
 *   - a lesson is ticked, anyone not ticked saved Absent and named above Save, and the day the
 *     class met may be changed (point 1);
 *   - make-ups are recorded from *Make-ups still owed* (point 2), and the register says M;
 *   - a Guide records nothing, and a closed week asks the Admin for a reason.
 */
async function signIn(page: Page, screens: 'RECORDING' | 'FULL') {
  await mockSignedIn(page);
  await mockTeacher(page, screens);
  await mockMyClasses(page);
}

async function openClass(page: Page, options: Parameters<typeof mockClassAttendance>[1] = {}) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, 'RECORDING');
  const mocked = await mockClassAttendance(page, options);
  await page.goto(`/equipping/teach/${ATTENDANCE_IDS.classId}`);
  await expect(page.getByRole('heading', { name: 'Life Class A', level: 1 })).toBeVisible();
  return mocked;
}

test('on the recording screens Equipping is an item, and the classes are grouped by what you do', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, 'RECORDING');
  await page.goto('/equipping/teach');
  await expect(page.getByRole('heading', { name: 'Equipping', level: 1 })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Equipping' })).toHaveAttribute('aria-current', 'page');

  const teach = page.getByRole('region', { name: 'Classes you teach' });
  await expect(teach).toContainText('You record each lesson and its make-ups.');
  await expect(teach.getByRole('link', { name: /Life Class A/ })).toHaveAttribute(
    'href',
    `/equipping/teach/${ATTENDANCE_IDS.classId}`,
  );
  const guide = page.getByRole('region', { name: 'Classes you guide' });
  await expect(guide).toContainText('You see your own students. You record nothing.');
  await expect(guide.getByRole('link', { name: /Life Class C/ })).toBeVisible();
});

test('for a Full view leader on a phone Equipping is a tab of Growth, and the bar keeps five', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'FULL');
  await page.goto('/equipping/teach');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Growth' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link').filter({ visible: true })).toHaveCount(5);
  const tabs = page.getByRole('navigation', { name: 'Growth' });
  await expect(tabs.getByRole('link', { name: 'Equipping' })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('link', { name: 'SUYNL' })).toBeVisible();
});

test('a lesson opens on the one still to record, names who will be saved absent, and saves', async ({
  page,
}) => {
  const { sent } = await openClass(page);
  // Lesson 3 is late, so the page opens on it, said in words.
  await expect(page.getByRole('button', { name: /L3\s*Late/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: /Lesson 3/, level: 2 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'came' })).toHaveText(
    '0 came · 2 absent: Efren Quiambao (Cell leader Gilbert Manalo), Imelda Tolentino (Cell leader none)',
  );

  await page.getByRole('checkbox', { name: 'Efren Quiambao came' }).check();
  await expect(page.getByRole('status').filter({ hasText: 'came' })).toHaveText(
    '1 came · 1 absent: Imelda Tolentino (Cell leader none)',
  );
  await page.getByRole('button', { name: 'Save lesson 3' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].url).toMatch(/\/lessons\/3$/);
  // The expected date, a week after lesson 2, and no version for a lesson never saved.
  expect(sent[0].body).toEqual({ held_on: '2026-11-17', came: [ATTENDANCE_IDS.efren] });
});

test('the Teacher may give another day the class met (decision 0503, point 1)', async ({ page }) => {
  const { sent } = await openClass(page);
  await page.getByLabel('Held on').fill('2026-11-18');
  await page.getByRole('button', { name: 'Tick all' }).click();
  await page.getByRole('button', { name: 'Save lesson 3' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].body).toEqual({
    held_on: '2026-11-18',
    came: [ATTENDANCE_IDS.efren, ATTENDANCE_IDS.imelda],
  });
});

test('a saved lesson is corrected with its version', async ({ page }) => {
  const { sent } = await openClass(page);
  await page.getByRole('button', { name: /L2\s*Saved/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Efren Quiambao came' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Efren Quiambao came' }).check();
  await page.getByRole('button', { name: 'Save lesson 2' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].body).toEqual({ held_on: '2026-11-10', came: [ATTENDANCE_IDS.efren], version: 1 });
});

test('a make-up is recorded from Make-ups still owed, and the register says M', async ({ page }) => {
  const { sent } = await openClass(page);
  const owed = page.getByRole('region', { name: /Make-ups still owed/ });
  await expect(owed.getByRole('heading')).toHaveText('Make-ups still owed · 1');
  await expect(owed.getByRole('listitem')).toHaveCount(1);
  await expect(owed.getByRole('listitem')).toContainText('Efren Quiambao · L2');
  await expect(owed.getByRole('listitem')).toContainText('Cell leader Gilbert Manalo');

  await owed.getByRole('button', { name: 'Record make-up' }).click();
  const dialog = page.getByRole('dialog', { name: 'Make-up for Efren Quiambao · L2' });
  await dialog.getByLabel('Date of the make-up').fill('2026-11-14');
  await dialog.getByRole('button', { name: 'Record make-up' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].url).toMatch(/\/make-ups$/);
  expect(sent[0].body).toEqual({ enrollment_id: ATTENDANCE_IDS.efren, lesson: 2, made_up_on: '2026-11-14' });

  // Imelda made lesson 2 up: M, said in words for a screen reader, and 2 of 2 kept.
  const register = page.getByRole('table', { name: 'Attendance so far, lesson by lesson' });
  const imelda = register.getByRole('row', { name: /Imelda Tolentino/ });
  await expect(imelda).toContainText('made up');
  await expect(imelda).toContainText('2 of 2');
  await expect(register.getByRole('row', { name: /Efren Quiambao/ })).toContainText('1 of 2');
});

test('a Guide reads the class and records nothing', async ({ page }) => {
  await openClass(page, { role: 'GUIDE' });
  await expect(page.getByText('You guide your own students here')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Save lesson/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record make-up' })).toHaveCount(0);
});

test('a closed week is the Admin’s, and asks a reason before it saves', async ({ page }) => {
  const { sent } = await openClass(page, { role: 'ADMIN', closedThree: true });
  await expect(page.getByRole('button', { name: /L3\s*Not recorded/ })).toBeVisible();
  await page.getByRole('button', { name: /L3\s*Not recorded/ }).click();
  const save = page.getByRole('button', { name: 'Save lesson 3' });
  await expect(save).toBeDisabled();
  await page.getByLabel('Reason for the correction').fill('The Teacher was ill and sent the sheet late.');
  await save.click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].body).toEqual({
    held_on: '2026-11-17',
    came: [],
    correction_reason: 'The Teacher was ill and sent the sheet late.',
  });
});

test('a Teacher reads a closed week and is told only the Admin corrects it', async ({ page }) => {
  await openClass(page, { closedThree: true });
  await page.getByRole('button', { name: /L3\s*Not recorded/ }).click();
  await expect(page.getByRole('heading', { name: /Lesson 3 .* Not recorded/, level: 2 })).toBeVisible();
  await expect(page.getByText('Its week has closed; only the Admin corrects it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save lesson 3' })).toHaveCount(0);
});
