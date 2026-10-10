import { expect, test } from '@playwright/test';

import { mockPeople, mockPersonCreated, mockSignedIn } from './mock-api';

/**
 * Add a person asks for a birthday and a mobile number, each unless *Not given yet* is
 * ticked (SKILL.md section 3, decision 0328). The API refuses a blank field without its
 * tick; what the screen owes is sending the tick, never a value beside it, and never
 * showing a value and a tick together.
 */
test.describe('Add a person: Not given yet (decision 0328)', () => {
  test('hides a tick once its field is typed, and shows it again when cleared', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await page.goto('/people/new');

    await expect(page.getByLabel('Not given yet')).toHaveCount(2);
    await page.getByLabel('Mobile number (required)').fill('0917 555 0142');
    await expect(page.getByLabel('Not given yet')).toHaveCount(1);
    await page.getByLabel('Mobile number (required)').fill('');
    await expect(page.getByLabel('Not given yet')).toHaveCount(2);
  });

  test('a ticked field is locked, and the request carries the tick and no value', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockPersonCreated(page);
    const bodies: Record<string, unknown>[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/v1/people')) {
        bodies.push(request.postDataJSON() as Record<string, unknown>);
      }
    });

    await page.goto('/people/new');
    await page.getByLabel('First name').fill('Marilou');
    await page.getByLabel('Last name').fill('Santos');
    await page.getByRole('radio', { name: 'Female' }).check();
    await page.getByRole('radio', { name: 'Married' }).check();
    await page.getByLabel('Not given yet').first().check();
    await expect(page.getByLabel('Birthday (required)')).toBeDisabled();
    await page.getByLabel('Mobile number (required)').fill('0917 555 0142');
    await page.getByLabel('Search for a leader by name').fill('ann');
    await page.getByRole('button', { name: 'Search people' }).click();
    await page.getByRole('button', { name: 'Choose' }).first().click();
    await page.getByRole('button', { name: 'Add this person' }).click();

    await expect.poll(() => bodies.length, { message: 'the person was never sent' }).toBe(1);
    expect(bodies[0]).toMatchObject({
      birth_date: null,
      birth_date_not_given: true,
      mobile_number: '0917 555 0142',
    });
    expect(bodies[0]).not.toHaveProperty('mobile_number_not_given');
  });
});
