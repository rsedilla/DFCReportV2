import { expect, test, type Page } from '@playwright/test';

import { mockAccountsAdministrator, mockAdminArea, mockCoordinator, mockSignedIn } from './mock-api';
import {
  mockCandidate,
  mockCoordinatedClasses,
  mockEquipping,
  mockRegistrar,
  mockRegistrationSearch,
} from './mock-equipping';

/**
 * SOL 1 in the school's screens (SKILL.md section 29, decision 0514), the first step: the Admin's
 * Coordinators list, the Level picker on Registration, Enrollment and Classes, SOL 1's three
 * requirements on the Register form, and a SOL 1 class with no Encounter. Every name is invented.
 */

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

const SOL_CLASS = '3f1b7c6e-0000-4000-8000-00000000e501';

test('the Admin sees who coordinates each level, each name opening their Account view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockAccountsAdministrator(page);
  await mockAdminArea(page);
  await page.goto('/admin?tab=accounts');
  const list = page.getByRole('region', { name: 'Coordinators' });
  await expect(list).toContainText("Who opens each level's classes. Change it on the person's Account view.");
  const table = list.getByRole('table', { name: 'Coordinators of each level' });
  await expect(table.getByRole('row', { name: /Life Class/ })).toContainText('Corazon Villareal, Rodel Ilagan');
  await expect(table.getByRole('row', { name: /SOL 1/ })).toContainText('None yet');
  await expect(list.getByRole('link', { name: 'Rodel Ilagan' })).toHaveAttribute(
    'href',
    '/people/6a1e0000-0000-4000-8000-000000000b02?view=account',
  );
});

async function registrar(page: Page) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await mockSignedIn(page);
  await mockRegistrar(page);
  await mockEquipping(page);
  await mockRegistrationSearch(page);
}

test('Registration picks a level, with how many are registered for each', async ({ page }) => {
  await registrar(page);
  const asked: string[] = [];
  await page.route('**/api/v1/equipping/registrations?*', (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('level') ?? '');
    return route.fulfill(json({ data: [], next_cursor: null }));
  });
  await page.goto('/equipping/registration');
  const level = page.getByRole('group', { name: 'Level' });
  await expect(level.getByRole('button', { name: 'Life Class · 2' })).toHaveAttribute('aria-pressed', 'true');
  await level.getByRole('button', { name: 'SOL 1 · 0' }).click();
  await expect(page.getByRole('button', { name: 'Register for SOL 1' })).toBeVisible();
  await expect(page.getByText(/Nobody is registered for SOL 1 in Term/)).toBeVisible();
  await expect.poll(() => asked.at(-1)).toBe('SOL_1');
});

test('the SOL 1 form reads three requirements, the manual ticked in its own row, and warns', async ({ page }) => {
  await registrar(page);
  await mockCandidate(page, false);
  // SOL 1's two read from the records: Life Class passed, Win 3 not yet.
  await page.route('**/api/v1/equipping/people/3f1b7c6e-0000-4000-8000-00000000f002?level=SOL_1', (route) =>
    route.fulfill(
      json({
        person: { id: '3f1b7c6e-0000-4000-8000-00000000f002', member_id: 'M-000519', full_name: 'Wilfredo Sanchez' },
        archived: false,
        leader_name: 'Marites D. Ramos',
        in_a_cell: true,
        cell_leader_name: 'Marites D. Ramos',
        birth_date: null,
        requirements: [
          { code: 'LIFE_CLASS_PASSED', met: true, detail: 'Passed Life Class A, Term 2, 2026' },
          { code: 'WIN_3', met: false, detail: 'needs Win 3, or 3 disciples under them in DREAMS' },
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
    return route.fulfill(json({ id: 'x', status: 'REGISTERED_WITH_EXCEPTION', unmet: ['WIN_3'] }, 201));
  });
  await page.goto('/equipping/registration');
  await page.getByRole('group', { name: 'Level' }).getByRole('button', { name: /SOL 1/ }).click();
  await page.getByRole('button', { name: 'Register for SOL 1' }).click();
  const dialog = page.getByRole('dialog', { name: 'Register for SOL 1' });
  await expect(dialog).toContainText('the SOL 1 manual is the tuition, paid outside DREAMS');
  await dialog.getByLabel('Person').fill('wil');
  await dialog.getByRole('button', { name: 'Search' }).click();
  await dialog.getByRole('button', { name: 'Choose Wilfredo Sanchez' }).click();

  const heading = dialog.getByRole('heading', { name: /Requirements/ });
  await expect(heading).toContainText('2 of 3 not met');
  await expect(dialog).toContainText('Life Class passed');
  // Win 3, or three disciples, and never how many (owner rulings of 2026-11-25).
  await expect(dialog).toContainText('Win 3, or 3 disciples');
  await expect(dialog).toContainText('Not met · needs Win 3, or 3 disciples under them in DREAMS');
  // No Bible tick, and no birthday notice: SOL has no Encounter.
  await expect(dialog.getByText('Has a physical Bible')).toHaveCount(0);
  await expect(dialog.getByText('Birthday missing.')).toHaveCount(0);

  await dialog.getByRole('checkbox', { name: /Has the SOL 1 Manual/ }).check();
  await expect(heading).toContainText('1 of 3 not met');
  await expect(dialog).toContainText(/Ticked by you, \d+ \w+ \d{4}/);

  // A requirement not met asks why (decision 0501, point 18), so the reason box appears.
  await dialog.getByLabel('Why register them anyway?').fill('His third disciple finishes lesson 3 this week.');
  await dialog.getByRole('button', { name: 'Register', exact: true }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual(
    expect.objectContaining({ level: 'SOL_1', manual_confirmed: true, exception_reason: expect.any(String) }),
  );
  expect(sent[0]).not.toHaveProperty('bible_confirmed');
});

test('a Coordinator of two levels picks between them, and is told who else coordinates', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockCoordinator(page);
  await mockCoordinatedClasses(page);
  await page.route('**/api/v1/equipping/coordinate/levels', (route) =>
    route.fulfill(json({ data: ['LIFE_CLASS', 'SOL_1'] })),
  );
  await page.route('**/api/v1/equipping/coordinate/classes?*', (route) => {
    const level = new URL(route.request().url()).searchParams.get('level');
    return route.fulfill(
      json({
        other_coordinators: level === 'SOL_1' ? [] : ['Teofilo Ramos'],
        data: [],
      }),
    );
  });
  await page.goto('/equipping/classes');
  await expect(page.getByText('Life Class, which you coordinate with Teofilo Ramos.')).toBeVisible();
  await page.getByRole('group', { name: 'Level' }).getByRole('button', { name: 'SOL 1' }).click();
  await expect(page.getByText('SOL 1, which you coordinate.')).toBeVisible();

  await page.getByRole('button', { name: 'Open a class' }).click();
  const dialog = page.getByRole('dialog', { name: 'Open a class' });
  await expect(dialog).toContainText(/SOL 1, Term/);
  await expect(dialog.getByLabel('Encounter weekend')).toHaveCount(0);
});

test('a Coordinator of one level is shown no Level picker', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockCoordinator(page);
  await mockCoordinatedClasses(page);
  await page.goto('/equipping/classes');
  await expect(page.getByRole('table', { name: /Life Class classes/ })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Level' })).toHaveCount(0);
});

test('a SOL 1 class has no Encounter, no age column, and holds 30', async ({ page }) => {
  await registrar(page);
  await page.route('**/api/v1/equipping/classes?*', (route) => {
    const level = new URL(route.request().url()).searchParams.get('level');
    return route.fulfill(
      json({
        data:
          level === 'SOL_1'
            ? [
                {
                  id: SOL_CLASS,
                  name: 'SOL 1 A',
                  day_of_week: 3,
                  time_of_day: '19:00',
                  place: 'Room 3',
                  first_lesson_on: '2026-12-02',
                  encounter_season_id: null,
                  run_by: 'CHURCH',
                  teacher: null,
                  enrolled: 1,
                },
              ]
            : [],
      }),
    );
  });
  await page.route(`**/api/v1/equipping/classes/${SOL_CLASS}`, (route) =>
    route.fulfill(
      json({
        class: {
          id: SOL_CLASS,
          name: 'SOL 1 A',
          level: 'SOL_1',
          day_of_week: 3,
          time_of_day: '19:00',
          place: 'Room 3',
          first_lesson_on: '2026-12-02',
          encounter_season_id: null,
          run_by: 'CHURCH',
          teacher: null,
          encounter_weekends: { mens: null, womens: null },
          lesson_6: null,
        },
        enrolled: [],
        ready: [
          {
            registration_id: '3f1b7c6e-0000-4000-8000-00000000e601',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e701', full_name: 'Carlito Manalo' },
            leader_name: 'Benito Cruz',
            with_exception: true,
            birthday_recorded: false,
            age_at_encounter: null,
            blocked: null,
          },
        ],
      }),
    ),
  );
  await page.goto('/equipping/enrollment');
  await page.getByRole('group', { name: 'Level' }).getByRole('button', { name: 'SOL 1' }).click();
  await expect(page.getByRole('button', { name: /SOL 1 A\s*Wed 7:00 pm · 1 of 30 enrolled/ })).toBeVisible();
  await expect(page.getByText(/Starts 2026-12-02 · 10 lessons/)).toBeVisible();
  await expect(page.getByText(/Encounter weekend/)).toHaveCount(0);
  await expect(page.getByText('· 1 registered for SOL 1, in no class yet')).toBeVisible();
  const ready = page.getByRole('table', { name: 'Ready to enroll in SOL 1 A' });
  await expect(ready.getByRole('columnheader', { name: 'Age at the Encounter' })).toHaveCount(0);
  // No birthday recorded, and still enrollable: a tick box, no reason under the name.
  await expect(ready.getByRole('checkbox', { name: 'Enroll Carlito Manalo' })).toBeVisible();
});
