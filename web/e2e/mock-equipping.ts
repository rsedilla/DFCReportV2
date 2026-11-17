import type { Page } from '@playwright/test';

/**
 * Equipping as the browser tests see it (SKILL.md section 29, decision 0499): an Equipper's
 * account, and one term's registrations and classes. Names are invented (CLAUDE.md, Secrets).
 */

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

const CLASS_ID = '3f1b7c6e-0000-4000-8000-00000000e001';

/** The signed-in account as an Equipper: `EQUIPPING` screens and `equipping.manage` alone. */
export async function mockEquipper(page: Page): Promise<void> {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill(
      json({
        account_id: '4f8c1d6a-0f1e-4b2a-9c3d-5e6f7a8b9c0d',
        person_id: '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9',
        email: 'equipper@example.invalid',
        first_name: 'Teresita',
        roles: ['EQUIPPER'],
        screens: 'EQUIPPING',
        people_i_oversee: false,
        privacy_notice: { version: '2026-11-16', acknowledged_at: '2026-11-16T01:00:00.000Z' },
        capabilities: [
          {
            capability: 'equipping.manage',
            scope_type: 'WHOLE_CHURCH',
            scope_network: null,
            read_only: false,
            source: 'ROLE',
          },
        ],
      }),
    ),
  );
}

/** One term: two registrations, one class with one person ready and one enrolled. */
export async function mockEquipping(page: Page): Promise<void> {
  await page.route('**/api/v1/equipping/registrations?*', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: '3f1b7c6e-0000-4000-8000-00000000e101',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e201', member_id: 'M-000951', full_name: 'Carlito Manalo' },
            leader_name: 'Benito Cruz',
            birthday_recorded: false,
            status: 'REGISTERED_WITH_EXCEPTION',
            unmet: ['DCC_REGULAR'],
            exception_reason: 'His leader confirms he attends every Sunday.',
            note: null,
            class: null,
            enrollment_id: null,
            registered_at: '2026-11-10T02:00:00.000Z',
            cancel_reason: null,
          },
          {
            id: '3f1b7c6e-0000-4000-8000-00000000e102',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e202', member_id: 'M-000952', full_name: 'Danica Flores' },
            leader_name: 'Mila Tan',
            birthday_recorded: true,
            status: 'ENROLLED',
            unmet: [],
            exception_reason: null,
            note: null,
            class: { id: CLASS_ID, name: 'Life Class A' },
            enrollment_id: '3f1b7c6e-0000-4000-8000-00000000e301',
            registered_at: '2026-11-09T02:00:00.000Z',
            cancel_reason: null,
          },
        ],
        next_cursor: null,
      }),
    ),
  );
  await page.route('**/api/v1/equipping/classes?*', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: CLASS_ID,
            name: 'Life Class A',
            day_of_week: 2,
            time_of_day: '19:00',
            place: 'Room 2',
            first_lesson_on: '2026-12-01',
            encounter_season_id: '3f1b7c6e-0000-4000-8000-00000000e401',
            run_by: 'CHURCH',
            teacher: { id: '3f1b7c6e-0000-4000-8000-00000000e203', full_name: 'Graciela Uy' },
            enrolled: 1,
          },
        ],
      }),
    ),
  );
  await page.route(`**/api/v1/equipping/classes/${CLASS_ID}`, (route) =>
    route.fulfill(
      json({
        class: {
          id: CLASS_ID,
          name: 'Life Class A',
          day_of_week: 2,
          time_of_day: '19:00',
          place: 'Room 2',
          first_lesson_on: '2026-12-01',
          encounter_season_id: '3f1b7c6e-0000-4000-8000-00000000e401',
          run_by: 'CHURCH',
          teacher: { id: '3f1b7c6e-0000-4000-8000-00000000e203', full_name: 'Graciela Uy' },
          encounter_weekends: { mens: '2026-12-04', womens: '2026-12-11' },
        },
        enrolled: [
          {
            enrollment_id: '3f1b7c6e-0000-4000-8000-00000000e301',
            registration_id: '3f1b7c6e-0000-4000-8000-00000000e102',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e202', full_name: 'Danica Flores' },
          },
        ],
        ready: [
          {
            registration_id: '3f1b7c6e-0000-4000-8000-00000000e103',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e204', full_name: 'Ernesto Lim' },
            leader_name: 'Benito Cruz',
            with_exception: false,
            birthday_recorded: true,
            age_at_encounter: 22,
            blocked: null,
          },
          {
            registration_id: '3f1b7c6e-0000-4000-8000-00000000e101',
            person: { id: '3f1b7c6e-0000-4000-8000-00000000e201', full_name: 'Carlito Manalo' },
            leader_name: 'Benito Cruz',
            with_exception: true,
            birthday_recorded: false,
            age_at_encounter: null,
            blocked: 'no birthday recorded',
          },
        ],
      }),
    ),
  );
  await page.route('**/api/v1/equipping/encounter-seasons', (route) =>
    route.fulfill(
      json({
        data: [
          {
            id: '3f1b7c6e-0000-4000-8000-00000000e401',
            mens_lc_party_on: '2026-10-30',
            mens_encounter_on: '2026-12-04',
            womens_lc_party_on: '2026-11-06',
            womens_encounter_on: '2026-12-11',
          },
        ],
      }),
    ),
  );
}
