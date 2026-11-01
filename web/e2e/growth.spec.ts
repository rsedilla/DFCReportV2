import { expect, test, type Page } from '@playwright/test';

import { SIGNED_IN_PERSON_ID, mockSignedIn, mockWholeChurchReader } from './mock-api';
import {
  SUYNL_IN_PROGRESS,
  TRAINING_COUNTS,
  TRAINING_NONE,
  TRAINING_NOT_MINE,
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

async function openSuynl(
  page: Page,
  outcome: 'accepted' | 'conflict' = 'accepted',
  path = '/growth/suynl',
) {
  await mockSignedIn(page);
  const traffic = await mockSuynl(page, outcome);
  await page.goto(path);
  await expect(page.getByRole('link', { name: 'Dalisay Soriano' })).toBeVisible();
  return traffic;
}

async function openTraining(page: Page, path = '/growth/training') {
  await mockSignedIn(page);
  // A whole-church reader's: a Full view leader is shown the note (decisions 0360 and 0379).
  await mockWholeChurchReader(page);
  const traffic = await mockTraining(page);
  await page.goto(path);
  await expect(page.getByRole('link', { name: 'Dalisay Soriano' })).toBeVisible();
  return traffic;
}

test.describe('the Growth tabs', () => {
  // A whole-church reader, as the Admin is: a Full view leader has SUYNL alone (decision 0360).
  test('are links, and the one open is marked as the current page', async ({ page }) => {
    await mockSignedIn(page);
    await mockWholeChurchReader(page);
    await mockSuynl(page);
    await mockTraining(page);
    await page.goto('/growth/suynl');

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
    await expect(tabs.getByRole('link')).toHaveText(['SUYNL', 'Training']);
  });

  test('are SUYNL alone for a Full view leader, and Training by its address shows the note (decisions 0360 and 0379)', async ({
    page,
  }) => {
    await openSuynl(page);
    await mockTraining(page);

    const tabs = page.getByRole('navigation', { name: 'Growth' });
    await expect(tabs.getByRole('link')).toHaveText(['SUYNL']);
    await expect(tabs.getByRole('link', { name: 'SUYNL' })).toHaveAttribute('aria-current', 'page');

    // Hidden, not withdrawn, and not offered by its address either (decision 0379).
    await page.goto('/growth/training');
    await expect(page.getByRole('heading', { name: 'This page isn’t part of your screens' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dalisay Soriano' })).toHaveCount(0);
  });

  test('sit under a Full view leader’s SUYNL item of the sidebar, which is the current page (decision 0383)', async ({
    page,
  }) => {
    await openSuynl(page);

    const current = page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText('SUYNL');
    await expect(page.getByRole('heading', { name: 'SUYNL', level: 1 })).toBeVisible();
  });
});

test.describe('the SUYNL tab', () => {
  test('shows two counts, and a card narrows the list and the address', async ({ page }) => {
    const traffic = await openSuynl(page);

    await expect(page.getByText('4 people you oversee, as of today.')).toBeVisible();
    // Each abbreviation is spelled out once, under the heading (UI label audit, Medium 7).
    await expect(page.getByText('SUYNL is Start Up Your New Life, ten lessons taken one to one.')).toBeVisible();
    const notStarted = page.getByRole('button', { name: /^Not started/ });
    const inProgress = page.getByRole('button', { name: /^In progress/ });
    await expect(notStarted).toContainText('1');
    await expect(inProgress).toContainText('2');
    // Graduated is hidden (decision 0386): a graduate is reached by a search.
    await expect(page.getByRole('button', { name: /^Graduated/ })).toHaveCount(0);
    // The opening view is those still to finish (decision 0287), which is no card.
    expect(lastList(traffic.lists).get('step')).toBe('STILL_TO_FINISH');
    for (const card of [notStarted, inProgress]) {
      await expect(card).toHaveAttribute('aria-pressed', 'false');
    }

    await inProgress.click();

    await expect(page).toHaveURL(/[?&]step=IN_PROGRESS\b/);
    await expect(inProgress).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => lastList(traffic.lists).get('step')).toBe('IN_PROGRESS');

    // Pressing the chosen card again clears it (decision 0281).
    await inProgress.click();

    await expect(page).not.toHaveURL(/step=/);
    await expect(inProgress).toHaveAttribute('aria-pressed', 'false');
    // No request is asserted here: the opening page is the one already fetched, and the
    // client may answer it from its cache. What it shows is asserted instead.
    await expect(page.getByRole('link', { name: 'Dalisay Soriano' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lualhati Dizon' })).toHaveCount(0);
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
    // Decision 0287: a leader's own disciples are shown whole, finished or not, and the
    // line counting the tab's finished people is not shown over a list it does not describe.
    expect(lastList(traffic.lists).has('step')).toBe(false);
    await expect(page.getByRole('button', { name: 'Show everyone', exact: true })).toHaveCount(0);
  });

  // Decision 0384: offered only where it would take away somebody besides the reader.
  for (const [tab, mockTab, counts] of [
    ['SUYNL', mockSuynl, { people: 3, not_started: 1, in_progress: 1, graduated: 1 }],
    [
      'Training',
      mockTraining,
      { people: 3, not_started: 1, encounter: 2, life_class: 1, sol_1: 0, sol_2: 0, sol_3: 0, all_five: 0 },
    ],
  ] as const) {
    test(`${tab} leaves "Only my disciples" out where nobody listed is beyond the reader's direct disciples (decision 0384)`, async ({
      page,
    }) => {
      await mockSignedIn(page);
      if (tab === 'Training') await mockWholeChurchReader(page);
      await mockTab(page, 'accepted', { counts: { ...counts, beyond_direct_disciples: 0 } });
      await page.goto(`/growth/${tab.toLowerCase()}`);
      await expect(page.getByRole('link', { name: 'Dalisay Soriano' })).toBeVisible();

      await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /only my disciples/i })).toHaveCount(0);
    });
  }

  test('keeps "Only my disciples" while it is on, so it can be turned off (decision 0384)', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockSuynl(page, 'accepted', {
      counts: { people: 3, not_started: 1, in_progress: 1, graduated: 1, beyond_direct_disciples: 0 },
    });
    await page.goto('/growth/suynl?mine=1');

    const on = page.getByRole('button', { name: 'Showing only my disciples' });
    await expect(on).toHaveAttribute('aria-pressed', 'true');
    await on.click();
    await expect(page).not.toHaveURL(/[?&]mine=1\b/);
    await expect(page.getByRole('button', { name: /only my disciples/i })).toHaveCount(0);
  });

  test('offers "Only my disciples" where the counts could not be read (decision 0384)', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockSuynl(page);
    await page.route('**/api/v1/suynl/counts', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }),
      }),
    );
    await page.goto('/growth/suynl');
    await expect(page.getByRole('link', { name: 'Dalisay Soriano' })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Only my disciples' })).toBeVisible();
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

  test('folds a graduated row to its date, and Edit lessons opens the ten boxes', async ({
    page,
  }) => {
    // The opening view leaves a graduated person out (decision 0287); everyone shows them
    // among the rest, which is where the fold has to hold.
    await openSuynl(page, 'accepted', '/growth/suynl?all=1');

    const row = page.getByRole('row', { name: /Lualhati Dizon/ });
    await expect(row.getByText('Graduated 14 August 2026')).toBeVisible();
    await expect(row.getByRole('checkbox')).toHaveCount(0);
    await expect(row).toContainText('10 of 10');
    await expect(row.getByRole('button', { name: /^Close/ })).toHaveCount(0);

    await row.getByRole('button', { name: 'Edit' }).click();

    const boxes = page.getByRole('checkbox', { name: /, Lualhati Dizon$/ });
    await expect(boxes).toHaveCount(10);
    for (let index = 0; index < 10; index += 1) {
      await expect(boxes.nth(index)).toBeChecked();
    }
    await expect(row.getByText(/^Graduated /)).toHaveCount(0);
  });

  test('Close folds an opened graduated row while nothing has changed', async ({ page }) => {
    const traffic = await openSuynl(page, 'accepted', '/growth/suynl?all=1');

    const row = page.getByRole('row', { name: /Lualhati Dizon/ });
    await row.getByRole('button', { name: 'Edit' }).click();
    await row.getByRole('button', { name: 'Close, Lualhati Dizon' }).click();

    await expect(row.getByText('Graduated 14 August 2026')).toBeVisible();
    await expect(row.getByRole('checkbox')).toHaveCount(0);
    expect(traffic.submitted).toHaveLength(0);
  });

  test('offers no Close once a box on the opened row has changed', async ({ page }) => {
    await openSuynl(page, 'accepted', '/growth/suynl?all=1');

    const row = page.getByRole('row', { name: /Lualhati Dizon/ });
    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('checkbox', { name: /^Lesson 10, .*Lualhati Dizon$/ }).uncheck();

    await expect(row).toContainText('9 of 10');
    await expect(row.getByRole('button', { name: /^Close/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Discard' })).toBeVisible();
  });

  test('offers no box on a row the reader may not file for', async ({ page }) => {
    await openSuynl(page);

    const row = page.getByRole('row', { name: /Bayani Castillo/ });
    await expect(row).toBeVisible();
    await expect(row.getByText('Not yours to record')).toBeVisible();
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

    // Said in the save bar, beside Save, so it is in view wherever the list was scrolled.
    const refusal = page
      .locator('main')
      .getByRole('alert')
      .filter({ hasText: 'lesson 3 was changed' });
    await expect(refusal).toContainText(
      'Dalisay Soriano · lesson 3 was changed by Rosario Magbanua after this page loaded. Reload to see it, then decide again.',
    );
    await expect(refusal).toBeInViewport();
    const reload = page.getByRole('button', { name: 'Reload' });
    await expect(reload).toBeVisible();
    await expect(reload).toBeInViewport();
    expect(traffic.submitted).toHaveLength(1);

    const before = traffic.lists.length;
    await reload.click();

    await expect.poll(() => traffic.lists.length).toBeGreaterThan(before);
    await expect(reload).toHaveCount(0);
    // Still made against what is stored, so the tick survives the reload.
    await expect(page.getByRole('button', { name: 'Save 1 change' })).toBeVisible();
  });

  test('keeps a lost race’s refusal and Reload when the draft is emptied instead', async ({
    page,
  }) => {
    await openSuynl(page, 'conflict');

    const tick = page.getByRole('checkbox', { name: 'Lesson 3, Dalisay Soriano' });
    await tick.check();
    await page.getByRole('button', { name: 'Save 1 change' }).click();
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();

    await tick.uncheck();

    await expect(
      page.locator('main').getByRole('alert').filter({ hasText: 'lesson 3 was changed' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  });
});

test.describe('the Training tab', () => {
  // The line beside the heading is the same on all three tabs, and the graduation-date
  // sentence that followed it on this one is gone.
  test('says how many people are in the reader’s care, and that a period count takes only dated graduations', async ({
    page,
  }) => {
    await openTraining(page);

    await expect(page.getByText('4 people you oversee, as of today.')).toBeVisible();
    await expect(page.getByText('LC Party is the Life Class Party, and SOL is the School of Leaders.')).toBeVisible();
    // Section 28 requires the screen to say this.
    await expect(
      page.getByText('A count of graduations in a period counts only the dated ones.'),
    ).toBeVisible();
  });

  test('shows done as "2 of 5" and "All five", and no box on a row the reader may not file for', async ({
    page,
  }) => {
    // "All five" is on a row the opening view leaves out (decision 0287).
    await openTraining(page, '/growth/training?all=1');

    await expect(page.getByRole('row', { name: /Dalisay Soriano/ })).toContainText('2 of 5');
    await expect(page.getByRole('row', { name: /Ernani Pascual/ })).toContainText('0 of 5');
    await expect(page.getByRole('row', { name: /Lualhati Dizon/ })).toContainText('All five');

    const notMine = page.getByRole('row', { name: /Bayani Castillo/ });
    await expect(notMine.getByText('Not yours to record')).toBeVisible();
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

test.describe('the SUYNL list opens on those still to finish (decisions 0287 and 0386)', () => {
  test('asks for STILL_TO_FINISH, leaves the graduated person out, and says nothing of them', async ({
    page,
  }) => {
    const traffic = await openSuynl(page);

    expect(lastList(traffic.lists).get('step')).toBe('STILL_TO_FINISH');
    await expect(page.getByRole('link', { name: 'Ernani Pascual' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bayani Castillo' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lualhati Dizon' })).toHaveCount(0);

    // Decision 0386: no line counting those who have finished, and no Show everyone.
    await expect(page.getByText(/finished all ten/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show everyone', exact: true })).toHaveCount(0);
  });

  test('a search finds a graduate, with their lessons, to correct one', async ({ page }) => {
    const traffic = await openSuynl(page);

    await page.getByLabel('Search by name or Member ID').fill('Dizon');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page).toHaveURL(/[?&]q=Dizon\b/);
    await expect.poll(() => lastList(traffic.lists).get('q')).toBe('Dizon');
    expect(lastList(traffic.lists).has('step')).toBe(false);
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Lualhati Dizon' }) });
    await expect(row.getByText('Graduated 14 August 2026')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Edit' })).toBeVisible();
  });

  // Decision 0386: hidden, not withdrawn, so both addresses still answer.
  test('an address naming GRADUATED still lists the graduates, with no card pressed', async ({
    page,
  }) => {
    await mockSignedIn(page);
    const traffic = await mockSuynl(page);
    await page.goto('/growth/suynl?step=GRADUATED');

    await expect(page.getByRole('link', { name: 'Lualhati Dizon' })).toBeVisible();
    expect(lastList(traffic.lists).get('step')).toBe('GRADUATED');
    for (const name of [/^Not started/, /^In progress/]) {
      await expect(page.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('an address carrying all=1 still lists everyone, and says nothing of them', async ({
    page,
  }) => {
    const traffic = await openSuynl(page, 'accepted', '/growth/suynl?all=1');

    expect(traffic.lists.every((sent) => !sent.has('step'))).toBe(true);
    await expect(page.getByRole('link', { name: 'Lualhati Dizon' })).toBeVisible();
    await expect(page.getByText(/finished all ten/)).toHaveCount(0);
  });

  test('a card asks for its own step, clears all=1, and clearing it returns to the opening view', async ({
    page,
  }) => {
    const traffic = await openSuynl(page, 'accepted', '/growth/suynl?all=1');

    await page.getByRole('button', { name: /^Not started/ }).click();

    await expect(page).toHaveURL(/[?&]step=NOT_STARTED\b/);
    await expect(page).not.toHaveURL(/all=/);
    await expect.poll(() => lastList(traffic.lists).get('step')).toBe('NOT_STARTED');
    await expect(page.getByRole('link', { name: 'Ernani Pascual' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lualhati Dizon' })).toHaveCount(0);

    await page.getByRole('button', { name: /^Not started/ }).click();

    await expect(page).not.toHaveURL(/step=|all=/);
    await expect(page.getByRole('link', { name: 'Dalisay Soriano' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lualhati Dizon' })).toHaveCount(0);
  });
});

test.describe('the Training list opens on those still to finish (decision 0287)', () => {
  const NOT_SHOWN = '1 who has finished all five is not shown.';
  const SHOWING = 'Showing everyone, the 1 who has finished all five included.';

  test('asks for STILL_TO_FINISH, leaves out the person holding all five, and says so', async ({
    page,
  }) => {
    const traffic = await openTraining(page);

    expect(lastList(traffic.lists).get('step')).toBe('STILL_TO_FINISH');
    await expect(page.getByRole('link', { name: 'Ernani Pascual' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lualhati Dizon' })).toHaveCount(0);
    await expect(page.getByText(NOT_SHOWN, { exact: true })).toBeVisible();
  });

  test('says "have" and "are" for more than one', async ({ page }) => {
    await mockSignedIn(page);
    await mockWholeChurchReader(page);
    await mockTraining(page, 'accepted', { counts: { ...TRAINING_COUNTS, all_five: 2 } });
    await page.goto('/growth/training');

    await expect(
      page.getByText('2 who have finished all five are not shown.', { exact: true }),
    ).toBeVisible();
  });

  test('Show everyone asks for no step and shows "All five", and toggles back', async ({
    page,
  }) => {
    const traffic = await openTraining(page);

    await page.getByRole('button', { name: 'Show everyone', exact: true }).click();

    await expect(page).toHaveURL(/[?&]all=1\b/);
    await expect(page.getByRole('row', { name: /Lualhati Dizon/ })).toContainText('All five');
    expect(lastList(traffic.lists).has('step')).toBe(false);
    await expect(page.getByText(SHOWING, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Show only those still to finish' }).click();

    await expect(page).not.toHaveURL(/all=/);
    await expect(page.getByRole('link', { name: 'Lualhati Dizon' })).toHaveCount(0);
    await expect(page.getByText(NOT_SHOWN, { exact: true })).toBeVisible();
  });

  test('a search asks for no step, and the line goes while it is shown', async ({ page }) => {
    const traffic = await openTraining(page);

    await page.getByLabel('Search by name or Member ID').fill('Dizon');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect.poll(() => lastList(traffic.lists).get('q')).toBe('Dizon');
    expect(lastList(traffic.lists).has('step')).toBe(false);
    await expect(page.getByText(NOT_SHOWN, { exact: true })).toHaveCount(0);
  });

  test('a card asks for its own step, clears all=1, and the line goes', async ({ page }) => {
    const traffic = await openTraining(page, '/growth/training?all=1');

    await page.getByRole('button', { name: /^SOL 3/ }).click();

    await expect(page).toHaveURL(/[?&]step=SOL_3\b/);
    await expect(page).not.toHaveURL(/all=/);
    await expect.poll(() => lastList(traffic.lists).get('step')).toBe('SOL_3');
    await expect(page.getByRole('link', { name: 'Lualhati Dizon' })).toBeVisible();
    await expect(page.getByText(SHOWING, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show everyone', exact: true })).toHaveCount(0);
  });

  test('says nothing when nobody holds all five', async ({ page }) => {
    await mockSignedIn(page);
    await mockWholeChurchReader(page);
    await mockTraining(page, 'accepted', {
      counts: { ...TRAINING_COUNTS, sol_1: 0, sol_2: 0, sol_3: 0, all_five: 0 },
      rows: [TRAINING_TWO, TRAINING_NONE, TRAINING_NOT_MINE],
    });
    await page.goto('/growth/training');

    await expect(page.getByRole('link', { name: 'Dalisay Soriano' })).toBeVisible();
    await expect(page.getByText(/finished all five/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show everyone', exact: true })).toHaveCount(0);
  });
});

test.describe('how many names a page shows', () => {
  for (const [width, size] of [
    [1280, '15'],
    [800, '12'],
    [390, '10'],
  ] as const) {
    test(`asks for ${size} names at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const traffic = await openSuynl(page);

      expect(traffic.lists.at(-1)?.get('limit')).toBe(size);
    });
  }
});

test('the reader\'s own row says another leader records it (decision 0280)', async ({ page }) => {
  await mockSignedIn(page);
  await page.route('**/api/v1/suynl/counts', (route) =>
    route.fulfill({ json: { people: 1, not_started: 1, in_progress: 0, graduated: 0 } }),
  );
  await page.route('**/api/v1/suynl/people?*', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            person_id: SIGNED_IN_PERSON_ID,
            member_id: 'M-000900',
            full_name: 'Signed-in Reader',
            lessons: [],
            graduated_on: null,
            may_file: false,
          },
        ],
        next_cursor: null,
      },
    }),
  );
  await page.goto('/growth/suynl');

  await expect(
    page.getByText('You · another leader records these').filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});
