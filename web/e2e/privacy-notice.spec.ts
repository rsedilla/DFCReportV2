import { expect, test } from '@playwright/test';

import { PERSON_IN_SCOPE, mockGrants, mockPeople, mockPrivacyNoticeUnread, mockSignedIn } from './mock-api';
import { mockPastoralPath } from './mock-attendance';

/**
 * The Privacy Notice tick (decision 0496): at activation, once in place of every screen for an account
 * that has not ticked it, and the line the Admin reads on a person's Account box.
 */

test('activation does nothing until the notice is ticked, and sends the notice ticked', async ({
  page,
}) => {
  const sent: unknown[] = [];
  await page.route('**/api/v1/auth/activate/username-suggestion', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"username":"mlsantos","taken":null}' }),
  );
  await page.route('**/api/v1/auth/activate', (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/activate?token=example-activation-token');
  await page.getByLabel('New password').fill('a long enough passphrase');

  const tick = page.getByRole('checkbox', { name: /I have read the Privacy Notice/ });
  const submit = page.getByRole('button', { name: 'Activate account' });
  await expect(tick).not.toBeChecked();
  await expect(submit).toBeDisabled();
  await expect(page.getByRole('link', { name: /Privacy Notice/ })).toHaveAttribute('href', '/privacy');

  await tick.check();
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({
    token: 'example-activation-token',
    privacy_notice_version: '2026-11-16',
  });
});

test('an account that has not ticked is asked once in place of the screen, then goes on', async ({
  page,
}) => {
  const { sent } = await mockPrivacyNoticeUnread(page);

  await page.goto('/session');
  await expect(page.getByRole('heading', { name: 'Before you continue' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My Account', exact: true })).toHaveCount(0);

  const cont = page.getByRole('button', { name: 'Continue' });
  await expect(cont).toBeDisabled();
  await page.getByRole('checkbox', { name: /I have read the Privacy Notice/ }).check();
  await cont.click();

  await expect(page.getByRole('heading', { name: 'My Account', exact: true })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0].body).toEqual({ version: '2026-11-16' });
  expect(sent[0].key).toEqual(expect.any(String));
});

test('an account that has ticked is not asked', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto('/session');
  await expect(page.getByRole('heading', { name: 'My Account', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Before you continue' })).toHaveCount(0);
});

test.describe("the Admin's Account box", () => {
  for (const [state, acknowledged, line] of [
    ['ticked', '2026-11-16T01:14:00.000Z', 'Privacy Notice: read on Nov 16, 2026, 9:14 AM.'],
    ['not ticked', null, 'Privacy Notice: not read yet. Marilou is asked the next time DREAMS is opened.'],
  ] as const) {
    test(`says when the holder ticked the notice: ${state}`, async ({ page }) => {
      await mockSignedIn(page);
      await mockPeople(page);
      await mockGrants(page, ['accounts.manage']);
      await mockPastoralPath(page);
      await page.route(`**/api/v1/accounts/for-person/${PERSON_IN_SCOPE.id}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            account: {
              id: '3f1b7c6e-0000-4000-8000-000000000901',
              email: 'marilou@example.test',
              status: 'ACTIVE',
              roles: ['LEADER'],
              created_at: '2026-09-22T02:00:00.000Z',
              second_step: { required: false, set_up_at: null },
              privacy_notice_acknowledged_at: acknowledged,
            },
          }),
        }),
      );

      await page.goto(`/people/${PERSON_IN_SCOPE.id}?view=account`);
      await expect(page.getByText(line)).toBeVisible();
    });
  }
});
