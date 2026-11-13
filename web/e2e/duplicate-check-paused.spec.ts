import { expect, test, type Page, type Route } from '@playwright/test';

import { PERSON_IN_SCOPE, mockPeople, mockPossibleMatches, mockSignedIn } from './mock-api';

/**
 * The duplicate check allows sixty a minute to one account (SKILL.md section 3, decision 0449).
 * Past it, Add a Person and Edit details say why the matches are not shown, instead of the box
 * vanishing, hold their save until a check has answered again, and ask again by themselves a
 * minute later.
 */

const PAUSED_TEXT =
  'It runs again by itself in a minute and shows any match it finds, in your care or elsewhere in the church.';

/**
 * Answers the check as `mode` says: refused for its limit, held unanswered, failed, or passed to the
 * matches mock. A held request is kept so the test can let it through later.
 */
async function routeCheck(page: Page) {
  const state: { mode: 'refuse' | 'hang' | 'fail' | 'answer'; held: Route[] } = {
    mode: 'refuse',
    held: [],
  };
  await page.route('**/api/v1/people/duplicate-candidates*', (route) => {
    if (state.mode === 'hang') {
      state.held.push(route);
      return;
    }
    if (state.mode === 'fail') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    }
    return state.mode === 'refuse'
      ? route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'RATE_LIMITED', message: 'Too many requests.', details: {} },
          }),
        })
      : route.fallback();
  });
  return state;
}

test('says the check is paused, holds Add Person, then shows the matches once it runs again', async ({
  page,
}) => {
  await page.clock.install();
  await mockSignedIn(page);
  await mockPeople(page);
  await mockPossibleMatches(page);
  const check = await routeCheck(page);

  await page.goto('/people/new');
  await page.getByLabel('First name').fill('Marilou');
  await page.getByLabel('Last name').fill('Santos');
  // A leader is chosen, so nothing but the paused check can be holding the save.
  await page.getByRole('radio', { name: 'Female' }).check();
  await page.getByLabel('Search for a leader by name').fill('ann');
  await page.getByRole('button', { name: 'Search people' }).click();
  await page.getByRole('button', { name: 'Choose' }).first().click();
  await page.clock.runFor(1_000);

  const paused = page.getByRole('region', {
    name: 'Checking for similar names is paused for a minute',
  });
  await expect(paused).toBeVisible();
  await expect(paused).toContainText(`${PAUSED_TEXT} Add Person waits until it has.`);
  // The save waits: a match in another branch is shown only by this check (decision 0449).
  const held = page.getByRole('button', { name: 'Add Person (after the check)' });
  await expect(held).toBeDisabled();

  // Changing a letter starts a new lookup. While it has not answered, the save stays held:
  // releasing it then would let it skip the check it is waiting for.
  check.mode = 'hang';
  await page.getByLabel('Last name').fill('Santoz');
  await page.clock.runFor(1_000);
  await expect.poll(() => check.held.length).toBeGreaterThan(0);
  await expect(held).toBeDisabled();
  await expect(paused).toBeVisible();

  // The check answers, and the matches take the box's place.
  check.mode = 'answer';
  for (const route of check.held.splice(0)) await route.fallback();
  await page.clock.runFor(61_000);
  await expect(
    page.getByRole('region', { name: 'Someone similar is already recorded' }),
  ).toBeVisible();
  await expect(paused).toHaveCount(0);
  await expect(held).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Person', exact: true })).toBeEnabled();
});

test('holds Save on Edit details while the check is paused, and lets it go once it answers', async ({
  page,
}) => {
  await page.clock.install();
  await mockSignedIn(page);
  await mockPeople(page);
  await mockPossibleMatches(page);
  const check = await routeCheck(page);

  await page.goto(`/people/${PERSON_IN_SCOPE.id}/edit`);
  // A changed name is checked; the record as it stands is not (decision 0396).
  await page.getByLabel('Last name').fill('Santoz');
  await page.clock.runFor(1_000);

  const paused = page.getByRole('region', {
    name: 'Checking for similar names is paused for a minute',
  });
  await expect(paused).toContainText(`${PAUSED_TEXT} Save waits until it has.`);
  await expect(page.getByRole('button', { name: 'Save (after the check)' })).toBeDisabled();

  check.mode = 'answer';
  await page.clock.runFor(61_000);
  await expect(paused).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
});

test('a lookup that fails for another reason lets the save go', async ({
  page,
}) => {
  await page.clock.install();
  await mockSignedIn(page);
  await mockPeople(page);
  await mockPossibleMatches(page);
  const check = await routeCheck(page);

  await page.goto(`/people/${PERSON_IN_SCOPE.id}/edit`);
  await page.getByLabel('Last name').fill('Santoz');
  await page.clock.runFor(1_000);
  await expect(page.getByRole('button', { name: 'Save (after the check)' })).toBeDisabled();

  // A server failure is not the limit: the box empties and Save comes back, as it would unpaused.
  check.mode = 'fail';
  await page.getByLabel('Last name').fill('Santox');
  await page.clock.runFor(30_000);
  await expect(
    page.getByRole('region', { name: 'Checking for similar names is paused for a minute' }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
});
