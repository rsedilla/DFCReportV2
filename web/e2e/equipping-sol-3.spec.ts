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
 * SOL 3 in the school's screens (SKILL.md section 29, decision 0517): the Admin's Coordinators
 * list, the SOL 3 pill, SOL 3's four requirements on the Register form, the twelve never shown as
 * a count, and opening a SOL 3 class. Every name is invented.
 */

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

const WIL = '3f1b7c6e-0000-4000-8000-00000000f002';

test('the Admin sees a SOL 3 row among the Coordinators', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockAccountsAdministrator(page);
  await mockAdminArea(page);
  await page.goto('/admin?tab=accounts');
  const table = page.getByRole('region', { name: 'Coordinators' }).getByRole('table', { name: 'Coordinators of each level' });
  await expect(table.getByRole('row', { name: /SOL 3/ })).toContainText('None yet');
});

async function registrar(page: Page) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await mockSignedIn(page);
  await mockRegistrar(page);
  await mockEquipping(page);
  await mockRegistrationSearch(page);
}

test('the SOL 3 form reads SOL 2 passed, a Cell led and the twelve, ticks the book, and warns', async ({ page }) => {
  await registrar(page);
  await mockCandidate(page, false);
  await page.route(`**/api/v1/equipping/people/${WIL}?level=SOL_3`, (route) =>
    route.fulfill(
      json({
        person: { id: WIL, member_id: 'M-000519', full_name: 'Wilfredo Sanchez' },
        archived: false,
        leader_name: 'Marites D. Ramos',
        in_a_cell: true,
        cell_leader_name: 'Marites D. Ramos',
        birth_date: null,
        requirements: [
          { code: 'SOL_2_PASSED', met: true, detail: 'Passed SOL 2 A, Term 1, 2027' },
          { code: 'LEADS_A_CELL', met: true, detail: 'Leads CELL-000214' },
          { code: 'TWELVE_DISCIPLES', met: false, detail: 'needs 12 disciples under them in DREAMS' },
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
    return route.fulfill(json({ id: 'x', status: 'REGISTERED_WITH_EXCEPTION', unmet: ['TWELVE_DISCIPLES'] }, 201));
  });
  await page.goto('/equipping/registration');
  await page.getByRole('group', { name: 'Level' }).getByRole('button', { name: /SOL 3/ }).click();
  await page.getByRole('button', { name: 'Register for SOL 3' }).click();
  const dialog = page.getByRole('dialog', { name: 'Register for SOL 3' });
  // One book (decision 0517, point 2).
  await expect(dialog).toContainText('the SOL 3 book is the tuition, paid outside DREAMS');
  await dialog.getByLabel('Person').fill('wil');
  await dialog.getByRole('button', { name: 'Search' }).click();
  await dialog.getByRole('button', { name: 'Choose Wilfredo Sanchez' }).click();

  const heading = dialog.getByRole('heading', { name: /Requirements/ });
  await expect(heading).toContainText('2 of 4 not met');
  await expect(dialog).toContainText('SOL 2 passed');
  await expect(dialog).toContainText('12 disciples now');
  await expect(dialog).toContainText('Not met · needs 12 disciples under them in DREAMS');

  await dialog.getByRole('checkbox', { name: /Has the SOL 3 book/ }).check();
  await expect(heading).toContainText('1 of 4 not met');
  await dialog.getByLabel('Why register them anyway?').fill('His twelfth disciple joins next week.');
  await dialog.getByRole('button', { name: 'Register', exact: true }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual(
    expect.objectContaining({ level: 'SOL_3', manual_confirmed: true, exception_reason: expect.any(String) }),
  );
});

test('a SOL 3 Coordinator opens a SOL 3 class with no Encounter weekend', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockSignedIn(page);
  await mockCoordinator(page);
  await mockCoordinatedClasses(page);
  await page.route('**/api/v1/equipping/coordinate/levels', (route) =>
    route.fulfill(json({ data: ['SOL_2', 'SOL_3'] })),
  );
  await page.route('**/api/v1/equipping/coordinate/classes?*', (route) =>
    route.fulfill(json({ other_coordinators: [], data: [] })),
  );
  await page.goto('/equipping/classes');
  const level = page.getByRole('group', { name: 'Level' });
  await expect(level.getByRole('button')).toHaveText(['SOL 2', 'SOL 3']);
  await level.getByRole('button', { name: 'SOL 3' }).click();
  await expect(page.getByText('SOL 3, which you coordinate.')).toBeVisible();
  await page.getByRole('button', { name: 'Open a class' }).click();
  const dialog = page.getByRole('dialog', { name: 'Open a class' });
  await expect(dialog).toContainText(/SOL 3, Term/);
  await expect(dialog.getByLabel('Encounter weekend')).toHaveCount(0);
});
