import { expect, test } from '@playwright/test';

import { ARCHIVED_MATCHES, mockArchivedMatches, mockPeople, mockSignedIn } from './mock-api';

/**
 * An archived duplicate candidate is labelled, and the reader is asked to have them restored
 * rather than added again (SKILL.md section 3, decision 0404). A match outside the reader's
 * branch names nobody and has no link (decision 0405).
 */
const IN_SCOPE = ARCHIVED_MATCHES[1] as { id: string; full_name: string };

test.describe('an archived match (decisions 0404 and 0405)', () => {
  test('on Add a person, is tagged and asks for a restore, linked only in the branch', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockArchivedMatches(page);
    await page.goto('/people/new');
    await page.getByLabel('First name').fill('Rosalinda');
    await page.getByLabel('Last name').fill('Ventura');

    const box = page.getByRole('region', {
      name: 'Someone similar is already recorded',
    });
    await expect(box).toBeVisible();
    const elsewhere = box.getByRole('listitem').filter({
      hasText:
        'Someone with a similar name in another branch was archived. Ask the Admin to restore them instead of adding them again.',
    });
    const inScope = box.getByRole('listitem').filter({ hasText: IN_SCOPE.full_name });

    await expect(elsewhere.getByText('Archived', { exact: true })).toBeVisible();
    await expect(inScope.getByText('Archived', { exact: true })).toBeVisible();
    await expect(
      inScope.getByText(
        'This person was archived. Ask the Admin to restore them instead of adding them again.',
      ),
    ).toBeVisible();
    // The reasons stay where they may be read.
    await expect(box.getByText(/A possible match/)).toHaveCount(0);
    await expect(inScope.getByText('Same first and last name')).toBeVisible();

    await expect(elsewhere.getByRole('link', { name: 'Open this record' })).toHaveCount(0);
    await expect(inScope.getByRole('link', { name: 'Open this record' })).toHaveAttribute(
      'href',
      `/people/${IN_SCOPE.id}`,
    );
  });

  test('outside the branch, two matches are one line each kind, naming nobody', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await page.route('**/api/v1/people/duplicate-candidates*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { possible_match: true },
            { possible_match: true },
            { possible_match: true, archived: true },
          ],
        }),
      }),
    );
    await page.goto('/people/new');
    await page.getByLabel('First name').fill('Rosalinda');
    await page.getByLabel('Last name').fill('Ventura');

    const box = page.getByRole('region', { name: 'Someone similar is already recorded' });
    await expect(box).toBeVisible();
    await expect(box.getByRole('listitem')).toHaveCount(2);
    await expect(
      box.getByText(
        'Someone with a similar name is already recorded in another branch. Ask the Admin before adding them.',
      ),
    ).toBeVisible();
    await expect(box.getByText('Archived', { exact: true })).toHaveCount(1);
    await expect(box.getByRole('link')).toHaveCount(0);
  });

  test('on the refusal, is tagged the same way', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await page.route('**/api/v1/people', (route) =>
      route.request().method() !== 'POST'
        ? route.fallback()
        : route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 'DUPLICATE_ACKNOWLEDGEMENT_REQUIRED',
                message: 'This may be someone already recorded.',
                details: { candidates: [{ ...IN_SCOPE, tier: 1 }] },
              },
            }),
          }),
    );

    await page.goto('/people/new');
    await page.getByLabel('First name').fill('Marilou');
    await page.getByLabel('Last name').fill('Santos');
    await page.getByRole('radio', { name: 'Female' }).check();
    await page.getByRole('radio', { name: 'Married' }).check();
    await page.getByLabel('Not given yet').first().check();
    await page.getByLabel('Not given yet').last().check();
    await page.getByLabel('Search for a leader by name').fill('ann');
    await page.getByRole('button', { name: 'Search people' }).click();
    await page.getByRole('button', { name: 'Choose' }).first().click();
    await page.getByRole('button', { name: 'Add this person' }).click();

    await expect(
      page.getByRole('heading', { name: 'Is this someone already recorded?' }),
    ).toBeVisible();
    await expect(page.getByText('Archived', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'This person was archived. Ask the Admin to restore them instead of adding them again.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open this record' })).toBeVisible();
  });
});
