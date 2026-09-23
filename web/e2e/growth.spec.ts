import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import {
  SUYNL_IN_PROGRESS,
  TRAINING_NONE,
  TRAINING_TWO,
  mockSuynl,
  mockTraining,
  suynlLessonId,
} from './mock-growth';

/**
 * What the two Growth tabs let a leader do (SKILL.md section 28; decisions 0278 to 0282).
 *
 * `accessibility.spec.ts` scans these screens for conformance, target size and overflow,
 * and none of those can tell whether a tick sends the right body, whether a withdrawal
 * waits for its reason, or whether a card narrows the request it claims to. These cases
 * pin that, each against the rule it follows.
 *
 * Run at the default desktop width, where the rows render as a table; the phone list
 * below `lg` carries the same controls and is hidden here, and `getByRole` sees only the
 * rendering on screen.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lastList(lists: URLSearchParams[]): URLSearchParams {
  return lists[lists.length - 1];
}

async function openSuynl(page: Page, outcome: 'accepted' | 'conflict' = 'accepted') {
  await mockSignedIn(page);
  const traffic = await mockSuynl(page, outcome);
  await page.goto('/growth/suynl');
  await expect(page.getByRole('link', { name: 'Dalisay Soriano' })).toBeVisible();
  return traffic;
}

async function openTraining(page: Page) {
  await mockSignedIn(page);
  const traffic = await mockTraining(page);
  await page.goto('/growth/training');
  await expect(page.getByRole('link', { name: 'Dalisay Soriano' })).toBeVisible();
  return traffic;
}

test.describe('the Growth tabs', () => {
  test('are links, and the one open is marked as the current page', async ({ page }) => {
    await openSuynl(page);
    await mockTraining(page);

    const tabs = page.getByRole('navigation', { name: 'Growth' });
    await expect(tabs.getByRole('link', { name: 'SUYNL' })).toHaveAttribute('aria-current', 'page');
    await expect(tabs.getByRole('link', { name: 'Training' })).not.toHaveAttribute('aria-current');

    await tabs.getByRole('link', { name: 'Training' }).click();

    await expect(page).toHaveURL(/\/growth\/training$/);
    await expect(tabs.getByRole('link', { name: 'Training' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(tabs.getByRole('link', { name: 'SUYNL' })).not.toHaveAttribute('aria-current');
  });

  test('sit under the Growth item of the sidebar, which is the current page', async ({ page }) => {
    await openSuynl(page);

    const current = page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText('Growth');
  });
});

test.describe('the SUYNL tab', () => {
  test('shows the three counts, and a card narrows the list and the address', async ({ page }) => {
    const traffic = await openSuynl(page);

    await expect(page.getByText('4 people.', { exact: false })).toBeVisible();
    const notStarted = page.getByRole('button', { name: /^Not started/ });
    const inProgress = page.getByRole('button', { name: /^In progress/ });
    const graduated = page.getByRole('button', { name: /^Graduated/ });
    await expect(notStarted).toContainText('1');
    await expect(inProgress).toContainText('2');
    await expect(graduated).toContainText('1');
    expect(lastList(traffic.lists).has('step')).toBe(false);

    await inProgress.click();

    await expect(page).toHaveURL(/[?&]step=IN_PROGRESS\b/);
    await expect(inProgress).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => lastList(traffic.lists).get('step')).toBe('IN_PROGRESS');

    // Pressing the chosen card again clears it (decision 0281).
    await inProgress.click();

    await expect(page).not.toHaveURL(/step=/);
    await expect(inProgress).toHaveAttribute('aria-pressed', 'false');
    // No request is asserted here: the unnarrowed page is the one already fetched, and
    // the client may answer it from its cache.
  });

  test('sends mine=true for "Only my disciples"', async ({ page }) => {
    const traffic = await openSuynl(page);
    expect(lastList(traffic.lists).has('mine')).toBe(false);

    await page.getByRole('button', { name: 'Only my disciples' }).click();

    await expect(page).toHaveURL(/[?&]mine=1\b/);
    await expect(page.getByRole('button', { name: 'Showing only my disciples' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect.poll(() => lastList(traffic.lists).get('mine')).toBe('true');
  });

  test('saves a tick as a lesson done, against no saved row, with an idempotency key', async ({
    page,
  }) => {
    const traffic = await openSuynl(page);

    // No save bar until something is ticked.
    await expect(page.getByRole('button', { name: 'Discard' })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Lesson 3, Dalisay Soriano' }).check();

    // A new tick withdraws nothing, so it asks no reason.
    await expect(page.getByLabel('Why is this being withdrawn or changed? (required)')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save 1 change' }).click();

    await expect.poll(() => traffic.submitted.length).toBe(1);
    expect(traffic.submitted[0].body).toEqual({
      changes: [{ person_id: SUYNL_IN_PROGRESS.person_id, lesson: 3, done: true, seen_id: null }],
    });
    expect(traffic.submitted[0].key).toMatch(UUID);
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  });

  test('asks why before an untick of a saved lesson can be saved, and sends the row it saw', async ({
    page,
  }) => {
    const traffic = await openSuynl(page);

    await page
      .getByRole('checkbox', { name: 'Lesson 2, filed 6 September 2026, Dalisay Soriano' })
      .uncheck();

    const why = page.getByLabel('Why is this being withdrawn or changed? (required)');
    const save = page.getByRole('button', { name: 'Save 1 change' });
    await expect(why).toBeVisible();
    await expect(save).toBeDisabled();

    // Blank is not an answer.
    await why.fill('   ');
    await expect(save).toBeDisabled();

    await why.fill('Ticked on the wrong row');
    await expect(save).toBeEnabled();
    await save.click();

    await expect.poll(() => traffic.submitted.length).toBe(1);
    expect(traffic.submitted[0].body).toEqual({
      changes: [
        {
          person_id: SUYNL_IN_PROGRESS.person_id,
          lesson: 2,
          done: false,
          seen_id: suynlLessonId(SUYNL_IN_PROGRESS.person_id, 2),
          reason: 'Ticked on the wrong row',
        },
      ],
    });
    expect(traffic.submitted[0].key).toMatch(UUID);
  });

  test('folds a graduated row to its date, and Correct opens the ten boxes', async ({ page }) => {
    await openSuynl(page);

    const row = page.getByRole('row', { name: /Lualhati Dizon/ });
    await expect(row.getByText('Graduated 14 August 2026')).toBeVisible();
    await expect(row.getByRole('checkbox')).toHaveCount(0);
    await expect(row).toContainText('10 of 10');

    await row.getByRole('button', { name: 'Correct' }).click();

    const boxes = page.getByRole('checkbox', { name: /, Lualhati Dizon$/ });
    await expect(boxes).toHaveCount(10);
    for (let index = 0; index < 10; index += 1) {
      await expect(boxes.nth(index)).toBeChecked();
    }
    await expect(row.getByText(/^Graduated /)).toHaveCount(0);
  });

  test('offers no box on a row the reader may not file for', async ({ page }) => {
    await openSuynl(page);

    const row = page.getByRole('row', { name: /Bayani Castillo/ });
    await expect(row).toBeVisible();
    await expect(row.getByText('Filed by their own leader')).toBeVisible();
    await expect(row.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /Bayani Castillo/ })).toHaveCount(0);
    await expect(row).toContainText('1 of 10');
  });

  test('shows the server’s words on a lost race, and a Reload that keeps the draft', async ({
    page,
  }) => {
    const traffic = await openSuynl(page, 'conflict');

    await page.getByRole('checkbox', { name: 'Lesson 3, Dalisay Soriano' }).check();
    await page.getByRole('button', { name: 'Save 1 change' }).click();

    await expect(page.locator('main').getByRole('alert')).toContainText(
      'Dalisay Soriano · lesson 3 was changed by Rosario Magbanua after this page loaded. Reload to see it, then decide again.',
    );
    const reload = page.getByRole('button', { name: 'Reload' });
    await expect(reload).toBeVisible();
    expect(traffic.submitted).toHaveLength(1);

    const before = traffic.lists.length;
    await reload.click();

    await expect.poll(() => traffic.lists.length).toBeGreaterThan(before);
    await expect(reload).toHaveCount(0);
    // Still made against what is stored, so the tick survives the reload.
    await expect(page.getByRole('button', { name: 'Save 1 change' })).toBeVisible();
  });
});

test.describe('the Training tab', () => {
  test('shows done as "2 of 5" and "All five", and no box on a row the reader may not file for', async ({
    page,
  }) => {
    await openTraining(page);

    await expect(page.getByRole('row', { name: /Dalisay Soriano/ })).toContainText('2 of 5');
    await expect(page.getByRole('row', { name: /Ernani Pascual/ })).toContainText('0 of 5');
    await expect(page.getByRole('row', { name: /Lualhati Dizon/ })).toContainText('All five');

    const notMine = page.getByRole('row', { name: /Bayani Castillo/ });
    await expect(notMine.getByText('Filed by their own leader')).toBeVisible();
    await expect(notMine.getByRole('checkbox')).toHaveCount(0);
  });

  test('offers an optional date on a tick, and sends graduated_on only when it is filled', async ({
    page,
  }) => {
    const traffic = await openTraining(page);

    await page.getByRole('checkbox', { name: 'Encounter, Ernani Pascual' }).check();
    const encounterDate = page
      .getByLabel('Date of Encounter, Ernani Pascual, optional')
      .filter({ visible: true });
    await expect(encounterDate).toBeVisible();
    await expect(encounterDate).toHaveValue('');
    await encounterDate.fill('2026-05-10');

    await page.getByRole('checkbox', { name: 'Life Class, Ernani Pascual' }).check();
    await expect(
      page.getByLabel('Date of Life Class, Ernani Pascual, optional').filter({ visible: true }),
    ).toBeVisible();

    // Neither withdraws nor re-dates anything saved, so no reason is asked.
    await expect(page.getByLabel('Why is this being withdrawn or changed? (required)')).toHaveCount(0);
    await expect(page.getByRole('row', { name: /Ernani Pascual/ })).toContainText('2 of 5');
    await page.getByRole('button', { name: 'Save 2 changes' }).click();

    await expect.poll(() => traffic.submitted.length).toBe(1);
    expect(traffic.submitted[0].body).toEqual({
      changes: [
        {
          person_id: TRAINING_NONE.person_id,
          program: 'ENCOUNTER',
          graduated: true,
          graduated_on: '2026-05-10',
          seen_id: null,
        },
        {
          person_id: TRAINING_NONE.person_id,
          program: 'LIFE_CLASS',
          graduated: true,
          seen_id: null,
        },
      ],
    });
    expect(traffic.submitted[0].key).toMatch(UUID);
  });

  test('asks why before a saved date is changed, and sends the row it saw', async ({ page }) => {
    const traffic = await openTraining(page);

    await page
      .getByRole('button', { name: 'Change the date of Encounter, Dalisay Soriano, now 8 March 2026' })
      .click();

    const date = page
      .getByLabel('Date of Encounter, Dalisay Soriano, optional')
      .filter({ visible: true });
    await expect(date).toHaveValue('2026-03-08');
    // Opening the date changes nothing, so there is nothing to save yet.
    await expect(page.getByRole('button', { name: /^Save \d/ })).toHaveCount(0);

    await date.fill('2026-03-15');

    const why = page.getByLabel('Why is this being withdrawn or changed? (required)');
    const save = page.getByRole('button', { name: 'Save 1 change' });
    await expect(why).toBeVisible();
    await expect(save).toBeDisabled();

    await why.fill('The certificate says the 15th');
    await expect(save).toBeEnabled();
    await save.click();

    await expect.poll(() => traffic.submitted.length).toBe(1);
    expect(traffic.submitted[0].body).toEqual({
      changes: [
        {
          person_id: TRAINING_TWO.person_id,
          program: 'ENCOUNTER',
          graduated: true,
          graduated_on: '2026-03-15',
          seen_id: TRAINING_TWO.graduations[0].id,
          reason: 'The certificate says the 15th',
        },
      ],
    });
  });

  test('asks why before a saved graduation is withdrawn', async ({ page }) => {
    const traffic = await openTraining(page);

    await page.getByRole('checkbox', { name: 'Life Class, Dalisay Soriano, no date' }).uncheck();

    const save = page.getByRole('button', { name: 'Save 1 change' });
    await expect(save).toBeDisabled();
    await page
      .getByLabel('Why is this being withdrawn or changed? (required)')
      .fill('Did not finish the class');
    await save.click();

    await expect.poll(() => traffic.submitted.length).toBe(1);
    expect(traffic.submitted[0].body).toEqual({
      changes: [
        {
          person_id: TRAINING_TWO.person_id,
          program: 'LIFE_CLASS',
          graduated: false,
          seen_id: TRAINING_TWO.graduations[1].id,
          reason: 'Did not finish the class',
        },
      ],
    });
  });
});
