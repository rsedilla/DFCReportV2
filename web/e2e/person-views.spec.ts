import { expect, test, type Page } from '@playwright/test';

import { PERSON_IN_SCOPE, mockPeople, mockSignedIn } from './mock-api';
import { mockPastoralPath } from './mock-attendance';

/**
 * Who opened this record (decision 0414): the Admin's section at the foot of a person's page.
 * Invented names.
 */

const PROFILE = `/people/${PERSON_IN_SCOPE.id}`;

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

/** An Admin: `accounts.manage` at Whole Church, which the section is offered to. */
async function asAdmin(page: Page) {
  await mockSignedIn(page);
  await mockPeople(page);
  await mockPastoralPath(page);
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill(
      json({
        account_id: '4f8c1d6a-0f1e-4b2a-9c3d-5e6f7a8b9c0d',
        person_id: '9a1b2c3d-4e5f-4061-8273-8495a6b7c8d9',
        email: 'admin@example.invalid',
        first_name: 'Marilou',
        roles: ['ADMIN'],
        screens: 'FULL',
        people_i_oversee: true,
        capabilities: ['people.view_subtree', 'people.create', 'accounts.manage'].map((capability) => ({
          capability,
          scope_type: 'WHOLE_CHURCH',
          scope_network: null,
          read_only: false,
          source: 'ROLE',
        })),
      }),
    ),
  );
  await page.route('**/api/v1/accounts/for-person/**', (route) => route.fulfill(json({ account: null })));
}

test('the Admin sees who opened the record, newest first, and can show more', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-01T04:00:00Z'));
  await asAdmin(page);
  const asked: string[] = [];
  await page.route(`**/api/v1/people/${PERSON_IN_SCOPE.id}/views*`, (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    return route.fulfill(
      json(
        url.searchParams.get('cursor') === null
          ? {
              data: [
                {
                  viewer: { person_id: '11111111-1111-4111-8111-111111111111', full_name: 'Corazon Batac' },
                  relation: 'PASTORAL_LEADER',
                  viewed_at: '2026-11-01T01:14:00Z',
                },
                {
                  viewer: { person_id: '22222222-2222-4222-8222-222222222222', full_name: 'Teofilo Ramos' },
                  relation: null,
                  viewed_at: '2026-10-31T11:02:00Z',
                },
              ],
              next_cursor: 'next-page',
            }
          : {
              data: [
                {
                  viewer: { person_id: '33333333-3333-4333-8333-333333333333', full_name: 'Alma Reyes' },
                  relation: null,
                  viewed_at: '2026-10-28T02:31:00Z',
                },
              ],
              next_cursor: null,
            },
      ),
    );
  });

  await page.goto(PROFILE);
  const section = page.getByRole('region', { name: 'Who opened this record' });
  await expect(section).toBeVisible();
  await expect(section.getByRole('listitem')).toHaveText([
    'Corazon Batac (pastoral leader) · Today, 9:14 am',
    'Teofilo Ramos · Yesterday, 7:02 pm',
  ]);

  await section.getByRole('button', { name: 'Show more' }).click();
  await expect(section.getByRole('listitem')).toHaveCount(3);
  await expect(section.getByRole('listitem').nth(2)).toHaveText('Alma Reyes · 28 Oct, 10:31 am');
  expect(asked).toContain('?cursor=next-page&limit=20');
});

test('a leader is not offered the section, and never asks for it', async ({ page }) => {
  await mockSignedIn(page);
  await mockPeople(page);
  await mockPastoralPath(page);
  let asked = false;
  await page.route(`**/api/v1/people/${PERSON_IN_SCOPE.id}/views*`, (route) => {
    asked = true;
    return route.fulfill(json({ data: [], next_cursor: null }));
  });

  await page.goto(PROFILE);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Who opened this record' })).toHaveCount(0);
  expect(asked).toBe(false);
});
