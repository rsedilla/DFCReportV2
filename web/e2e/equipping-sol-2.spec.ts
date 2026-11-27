import { expect, test, type Page } from '@playwright/test';

import { mockAccountsAdministrator, mockAdminArea, mockCoordinator, mockSignedIn } from './mock-api';
import {
  ATTENDANCE_IDS,
  mockCandidate,
  mockCoordinatedClasses,
  mockEquipping,
  mockFinalGrades,
  mockMyClasses,
  mockRegistrar,
  mockRegistrationSearch,
  mockSolAttendance,
  mockSolFinalGrades,
  mockTeacher,
} from './mock-equipping';

/**
 * SOL 2 in the school's screens (SKILL.md section 29, decision 0516): the Admin's Coordinators
 * list, the SOL 2 pill on Registration, Classes and Final Grades, SOL 2's three requirements on the
 * Register form, the book being the tuition, opening a SOL 2 class, and its Teacher's register.
 * Every name is invented.
 */

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

const WIL = '3f1b7c6e-0000-4000-8000-00000000f002';

test('the Admin sees SOL 2’s Coordinators, each name opening their Account view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockAccountsAdministrator(page);
  await mockAdminArea(page);
  await page.goto('/admin?tab=accounts');
  const table = page.getByRole('region', { name: 'Coordinators' }).getByRole('table', { name: 'Coordinators of each level' });
  await expect(table.getByRole('row', { name: /SOL 2/ })).toContainText('Ernesto Dimalanta');
  await expect(table.getByRole('link', { name: 'Ernesto Dimalanta' })).toHaveAttribute(
    'href',
    '/people/6a1e0000-0000-4000-8000-000000000b03?view=account',
  );
});

async function registrar(page: Page) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await mockSignedIn(page);
  await mockRegistrar(page);
  await mockEquipping(page);
  await mockRegistrationSearch(page);
}

test('Registration offers SOL 2 as a third level, with its count', async ({ page }) => {
  await registrar(page);
  const asked: string[] = [];
  await page.route('**/api/v1/equipping/registrations?*', (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('level') ?? '');
    return route.fulfill(json({ data: [], next_cursor: null }));
  });
  await page.goto('/equipping/registration');
  const level = page.getByRole('group', { name: 'Level' });
  await expect(level.getByRole('button')).toHaveText(['Life Class · 2', 'SOL 1 · 0', 'SOL 2 · 0']);
  await level.getByRole('button', { name: 'SOL 2 · 0' }).click();
  await expect(page.getByRole('button', { name: 'Register for SOL 2' })).toBeVisible();
  await expect(page.getByText(/Nobody is registered for SOL 2 in Term/)).toBeVisible();
  await expect.poll(() => asked.at(-1)).toBe('SOL_2');
});

test('the SOL 2 form reads SOL 1 passed and a Cell led, ticks the book, and warns', async ({ page }) => {
  await registrar(page);
  await mockCandidate(page, false);
  await page.route(`**/api/v1/equipping/people/${WIL}?level=SOL_2`, (route) =>
    route.fulfill(
      json({
        person: { id: WIL, member_id: 'M-000519', full_name: 'Wilfredo Sanchez' },
        archived: false,
        leader_name: 'Marites D. Ramos',
        in_a_cell: true,
        cell_leader_name: 'Marites D. Ramos',
        birth_date: null,
        requirements: [
          { code: 'SOL_1_PASSED', met: true, detail: 'Passed SOL 1 A, Term 1, 2026' },
          { code: 'LEADS_A_CELL', met: false, detail: 'leads no Cell now' },
        ],
        earlier_tries: [],
        joins_at_lesson_6: null,
      }),
    ),
  );
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/v1/equipping/registrations', (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill(json({ id: 'x', status: 'REGISTERED_WITH_EXCEPTION', unmet: ['LEADS_A_CELL'] }, 201));
  });
  await page.goto('/equipping/registration');
  await page.getByRole('group', { name: 'Level' }).getByRole('button', { name: /SOL 2/ }).click();
  await page.getByRole('button', { name: 'Register for SOL 2' }).click();
  const dialog = page.getByRole('dialog', { name: 'Register for SOL 2' });
  // One book: the tuition is the book the student reads to pass (decision 0516, point 2).
  await expect(dialog).toContainText('the SOL 2 book is the tuition, paid outside DREAMS');
  await dialog.getByLabel('Person').fill('wil');
  await dialog.getByRole('button', { name: 'Search' }).click();
  await dialog.getByRole('button', { name: 'Choose Wilfredo Sanchez' }).click();

  const heading = dialog.getByRole('heading', { name: /Requirements/ });
  await expect(heading).toContainText('2 of 3 not met');
  await expect(dialog).toContainText('SOL 1 passed');
  await expect(dialog).toContainText('Passed SOL 1 A, Term 1, 2026');
  await expect(dialog).toContainText('Not met · leads no Cell now');
  await expect(dialog.getByText('Has a physical Bible')).toHaveCount(0);

  await dialog.getByRole('checkbox', { name: /Has the SOL 2 book/ }).check();
  await expect(heading).toContainText('1 of 3 not met');

  await dialog.getByLabel('Why register them anyway?').fill('His Cell restarts next week.');
  await dialog.getByRole('button', { name: 'Register', exact: true }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual(
    expect.objectContaining({ level: 'SOL_2', manual_confirmed: true, exception_reason: expect.any(String) }),
  );
  expect(sent[0]).not.toHaveProperty('bible_confirmed');
});

test('a Coordinator of SOL 1 and SOL 2 picks between them, and opens a SOL 2 class with no Encounter', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockCoordinator(page);
  await mockCoordinatedClasses(page);
  await page.route('**/api/v1/equipping/coordinate/levels', (route) =>
    route.fulfill(json({ data: ['SOL_1', 'SOL_2'] })),
  );
  await page.route('**/api/v1/equipping/coordinate/classes?*', (route) =>
    route.fulfill(json({ other_coordinators: [], data: [] })),
  );
  await page.goto('/equipping/classes');
  const level = page.getByRole('group', { name: 'Level' });
  await expect(level.getByRole('button')).toHaveText(['SOL 1', 'SOL 2']);
  await level.getByRole('button', { name: 'SOL 2' }).click();
  await expect(page.getByText('SOL 2, which you coordinate.')).toBeVisible();
  await expect(page.getByText(/No SOL 2 class is open in Term/)).toBeVisible();

  await page.getByRole('button', { name: 'Open a class' }).click();
  const dialog = page.getByRole('dialog', { name: 'Open a class' });
  await expect(dialog).toContainText(/SOL 2, Term/);
  await expect(dialog.getByLabel('Encounter weekend')).toHaveCount(0);
});

test('Final Grades offers SOL 2 beside Life Class and SOL 1', async ({ page }) => {
  await registrar(page);
  await page.goto('/equipping/final-grades');
  await expect(page.getByRole('group', { name: 'Level' }).getByRole('button')).toHaveText([
    /Life Class/,
    /SOL 1/,
    /SOL 2/,
  ]);
});

test('a SOL 2 class’s Teacher keeps the SOL register: memory verse and devotional with each lesson', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await mockSignedIn(page);
  await mockTeacher(page, 'RECORDING');
  await mockMyClasses(page);
  await mockSolAttendance(page, { level: 'SOL_2' });
  await page.goto(`/equipping/teach/${ATTENDANCE_IDS.classId}`);
  await expect(page.getByRole('heading', { name: 'SOL 2 A', level: 1 })).toBeVisible();
  await expect(page.getByText('Memory verse', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Devotional', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Quiz and book/ })).toBeVisible();
});

test('the Admin’s change after posting names SOL 2 as what Training files (decision 0516)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockRegistrar(page);
  await mockFinalGrades(page, 'POSTED');
  await mockSolFinalGrades(page, { posted: true, level: 'SOL_2' });
  await page.goto('/equipping/final-grades');
  await page.getByRole('group', { name: 'Level' }).getByRole('button', { name: /SOL 2/ }).click();
  await page.getByRole('button', { name: 'Change Nestor Villamor’s record' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change Nestor Villamor’s record' });
  await dialog.getByLabel('What to change').selectOption('BOOK');
  await dialog.getByRole('radio', { name: 'Read', exact: true }).check();
  await dialog.getByLabel('Details (required)').fill('Read before posting; the Teacher missed the tick.');
  // What the grade becomes is shown before anything is saved, Training's part with it.
  await expect(dialog).toContainText('SOL 2 goes into their Training from the school');
  await expect(dialog).not.toContainText('SOL 1 goes into');
});
