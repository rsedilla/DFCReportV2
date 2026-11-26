import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import {
  ATTENDANCE_IDS,
  mockCandidate,
  mockClassAttendance,
  mockEquipping,
  mockMyClasses,
  mockRegistrar,
  mockRegistrationSearch,
  mockTeacher,
} from './mock-equipping';

/**
 * Joining a later class at Lesson 6 (SKILL.md section 29, decision 0512): the Register form says
 * what is kept, Enrollment gives the class's Lesson 6 day and *Start from Lesson 1 instead*, and
 * the Teacher's register names the kept lessons and leaves the student off lessons 1 to 4.
 */
async function registrar(page: Page, path: string, options: { lesson6Passed?: boolean } = {}) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockRegistrar(page);
  await mockEquipping(page, { tries: true, joins: true, ...options });
  await mockRegistrationSearch(page);
  await page.goto(path);
}

test('the Register form says they join a later class at Lesson 6', async ({ page }) => {
  await registrar(page, '/equipping/registration');
  await mockCandidate(page, true, true);
  await page.getByRole('button', { name: 'Register for Life Class' }).click();
  const dialog = page.getByRole('dialog', { name: 'Register for Life Class' });
  await dialog.getByLabel('Person').fill('wil');
  await dialog.getByRole('button', { name: 'Search' }).click();
  await dialog.getByRole('button', { name: 'Choose Wilfredo Sanchez' }).click();
  const box = dialog.getByRole('region', { name: 'Took Life Class before' });
  await expect(box).toContainText('Joins a later class at Lesson 6');
  await expect(box).toContainText(
    'Keeps lessons 1 to 4 and the Encounter from Term 2, 2026, so only lessons 6 to 9 are left.',
  );
});

test('Enrollment gives the Lesson 6 day, and Start from Lesson 1 is sent when ticked', async ({ page }) => {
  await registrar(page, '/equipping/enrollment');
  const sent: unknown[] = [];
  await page.route('**/api/v1/equipping/classes/*/enrollments', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, contentType: 'application/json', body: '{"class_id":"x","enrolled":[]}' });
  });
  await expect(page.getByText(/Lesson 6 on 5 Jan 2027/)).toBeVisible();
  const row = page.getByRole('row', { name: /Ernesto Lim/ });
  await expect(row).toContainText('Joins at Lesson 6 · 5 Jan 2027');
  await expect(row).toContainText('Keeps L1 to L4 and the Encounter from Term 2, 2026, Life Class B');

  await row.getByLabel('Enroll Ernesto Lim').check();
  await row.getByLabel('Start from Lesson 1 instead').check();
  await expect(row).toContainText('Starts from Lesson 1');
  await page.getByRole('button', { name: /^Enroll 1 in/ }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({
    registration_ids: ['3f1b7c6e-0000-4000-8000-00000000e103'],
    start_from_lesson_1: ['3f1b7c6e-0000-4000-8000-00000000e103'],
  });
});

test('a class past its Lesson 6 says so on the row', async ({ page }) => {
  await registrar(page, '/equipping/enrollment', { lesson6Passed: true });
  await expect(page.getByRole('row', { name: /Ernesto Lim/ })).toContainText(
    'Joins at Lesson 6, which this class has passed: choose another class, or start from Lesson 1',
  );
});

test('the register names the kept lessons and leaves them off lessons 1 to 4', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockTeacher(page, 'RECORDING');
  await mockMyClasses(page);
  await mockClassAttendance(page, { carried: true });
  await page.goto(`/equipping/teach/${ATTENDANCE_IDS.classId}`);
  await expect(page.getByRole('heading', { name: 'Life Class A', level: 1 })).toBeVisible();
  // Lesson 3 is open: Ramil is not on its tick list, and the line says why.
  await expect(page.getByRole('checkbox', { name: /Ramil Cruz/ })).toHaveCount(0);
  await expect(page.getByText('Joined at Lesson 6, keeping lessons 1 to 4 from an earlier class: Ramil Cruz.')).toBeVisible();
  const row = page.getByRole('row', { name: /Cruz, Ramil/ });
  await expect(row).toContainText('Joins at Lesson 6 · L1 to L4 and ENC kept from Life Class B, Term 2, 2026');
  await expect(row).not.toContainText('Moved from');
});
