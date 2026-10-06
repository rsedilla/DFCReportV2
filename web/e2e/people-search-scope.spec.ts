import { expect, test } from '@playwright/test';

import { PERSON_IN_SCOPE, mockGrants, mockPeople, mockSignedIn } from './mock-api';
import {
  CELL_WITH_MEETINGS,
  mockCellMeetings,
  mockCellMembers,
  mockMeetingRoster,
  mockPastoralPath,
} from './mock-attendance';

/**
 * Which search each surface asks for (SKILL.md section 8, decision 0244).
 *
 * The People screen shows the people a leader pastors. The three person pickers —
 * Add a Person, Add a member to a Cell, and naming a new pastoral leader on a
 * reassignment — keep the church-wide directory, because each names one specific
 * person for one operation rather than offering a place to look around. Two of them
 * are then narrowed to one Network (decision 0299): adding a Cell member searches the
 * Cell's leader's Network, and naming a new pastoral leader the moved person's. Adding
 * a Person and naming who ran a Cell meeting are not narrowed.
 *
 * **This asserts the request rather than the rendered rows, and that is the point.**
 * The narrowing is enforced by the API: the rows a leader may see are decided there,
 * against their capability's scope, and a browser test against a mocked response
 * would assert only what the mock returned. What the client owes is sending the
 * right question, and that is invisible in a passing screen — both surfaces render
 * identically whichever flag they send, because the mock answers the same either
 * way. It is exactly the shape `session.spec.ts` exists for one domain over.
 *
 * The API-layer cases in `api/test/api/people.e2e.spec.ts` cover the other half:
 * that the flag narrows rows, never widens fields, and spends a page limit on rows
 * it returns.
 */

/** Every `/api/v1/people?…` request the page made, in order. */
async function recordSearches(page: import('@playwright/test').Page): Promise<string[]> {
  const urls: string[] = [];

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/v1/people?')) {
      urls.push(url);
    }
  });

  return urls;
}

test.describe('which search each surface asks for', () => {
  test('the People screen opens on everyone, with each leader and Cell (decision 0259)', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    const searches = await recordSearches(page);

    await page.goto('/people');

    const table = page.getByRole('table', { name: 'People you oversee' });
    await expect(table.getByRole('row', { name: /Marilou Reyes Santos/ })).toContainText(
      'Teofilo Ramos',
    );
    await expect(table.getByRole('row', { name: /Marilou Reyes Santos/ })).toContainText(
      'Youth · Sat',
    );
    // No term was typed, and the first request asked for ten of the searcher's own scope.
    expect(searches[0]).not.toContain('q=');
    expect(searches[0]).toContain('limit=10');
    expect(searches[0]).not.toContain('church_wide');
  });

  test('the People screen asks for its own scope', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    const searches = await recordSearches(page);

    await page.goto('/people');
    await page.getByLabel('Search by name').fill('Bautista');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect
      .poll(() => searches.length, { message: 'the screen never searched' })
      .toBeGreaterThan(0);

    for (const url of searches) {
      expect(url, 'the People screen asked for the whole church').not.toContain('church_wide');
    }
  });

  test('adding a person searches the whole church, so a duplicate is found', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    const searches = await recordSearches(page);

    await page.goto('/people/new');
    // The picker on this screen chooses the new person's pastoral leader. Its own
    // label and button differ from the People screen's, which is why they are named
    // rather than reused.
    await page.getByLabel('Search for a leader by name').fill('Bautista');
    await page.getByRole('button', { name: 'Find' }).click();

    await expect
      .poll(() => searches.length, { message: 'the picker never searched' })
      .toBeGreaterThan(0);

    expect(
      searches.some((url) => url.includes('church_wide=true')),
      'the picker narrowed itself to the actor scope, which would make a person in another branch unreachable',
    ).toBe(true);
    // Decision 0299 narrows two pickers and not this one: the new person has no Network
    // until their sex is chosen.
    for (const url of searches) {
      expect(url, 'Add a Person narrowed its search to one Network').not.toContain('network=');
    }
  });
});

/**
 * The two pickers that search one Network (decision 0299), and the one of the other two
 * not covered above.
 *
 * As above, the request is what is asserted: the API does the filtering, so a mocked
 * answer looks the same whichever Network was asked for.
 */
test.describe('which Network a picker searches (decision 0299)', () => {
  const MEMBERS = `/cells/${CELL_WITH_MEETINGS.id}/members`;
  const LEADER_ID = CELL_WITH_MEETINGS.leader.person_id;

  /** The Cell's leader as `GET /people/:id` answers for somebody in scope: a man. */
  const CELL_LEADER_FULL = {
    scope: 'FULL',
    id: LEADER_ID,
    member_id: CELL_WITH_MEETINGS.leader.member_id,
    title: null,
    first_name: 'Teofilo',
    middle_name: null,
    last_name: 'Ramos',
    full_name: CELL_WITH_MEETINGS.leader.full_name,
    birth_date: null,
    sex: 'MALE',
    civil_status: 'MARRIED',
    mobile_number: null,
  };

  test('adding a Cell member searches the Men’s Network for a Men’s Cell, and says why', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockCellMeetings(page);
    await mockCellMembers(page);
    await page.route(`**/api/v1/people/${LEADER_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CELL_LEADER_FULL),
      }),
    );
    const searches = await recordSearches(page);

    await page.goto(MEMBERS);
    await page.getByRole('button', { name: 'Add a member' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add a member to CELL-000007' });
    // The note is what says the leader has been read, so the search below is made with
    // the Network known rather than racing it.
    await expect(
      dialog.getByText(
        'Showing the Men’s Network only, because this Cell is in the Men’s Network.',
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText("Search by name. They must be in the same Network as this Cell's leader."),
    ).toBeVisible();

    await dialog.getByLabel('Search for a person by name').fill('Marilou');
    await dialog.getByRole('button', { name: 'Find' }).click();

    await expect
      .poll(() => searches.filter((u) => new URL(u).searchParams.get('q') === 'Marilou').length, {
        message: 'the picker never searched',
      })
      .toBeGreaterThan(0);
    // Every search the picker made, whatever else the page may ask the same route.
    for (const url of searches.filter((u) => new URL(u).searchParams.get('q') === 'Marilou')) {
      const params = new URL(url).searchParams;
      expect(params.get('network')).toBe('MENS');
      expect(params.get('church_wide')).toBe('true');
    }
  });

  test('adding a Cell member stays church-wide, with no note, when the leader cannot be read', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockCellMeetings(page);
    await mockCellMembers(page);
    await page.route(`**/api/v1/people/${LEADER_ID}`, (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'NOT_FOUND', message: 'No such person.', details: {} },
        }),
      }),
    );
    const searches = await recordSearches(page);
    const leaderRead = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/people/${LEADER_ID}`),
    );

    await page.goto(MEMBERS);
    // Answered, and refused, before the search is made, so the case measures the fallback
    // rather than a search sent before the read came back.
    await leaderRead;
    await page.getByRole('button', { name: 'Add a member' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add a member to CELL-000007' });
    await dialog.getByLabel('Search for a person by name').fill('Marilou');
    await dialog.getByRole('button', { name: 'Find' }).click();

    await expect(dialog.getByRole('button', { name: 'Choose' }).first()).toBeVisible();
    expect(searches.length).toBeGreaterThan(0);
    for (const url of searches) {
      expect(url, 'a search was narrowed with no Network read').not.toContain('network=');
      expect(url).toContain('church_wide=true');
    }
    await expect(dialog.getByText(/Network only, because/)).toHaveCount(0);
  });

  test('naming a new pastoral leader searches the moved person’s Network, and says why', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockGrants(page, ['people.manage_pastoral_assignment']);
    await mockPastoralPath(page);
    const searches = await recordSearches(page);

    // `PERSON_IN_SCOPE` is a woman, read in full, so her Network comes from her sex.
    await page.goto(`/people/${PERSON_IN_SCOPE.id}`);
    await page.getByRole('button', { name: 'Move to another leader' }).click();

    const dialog = page.getByRole('dialog', {
      name: `Move ${PERSON_IN_SCOPE.full_name} to another leader`,
    });
    await expect(
      dialog.getByText(
        `Showing the Women’s Network only, because ${PERSON_IN_SCOPE.full_name} is in the Women’s Network.`,
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        'Search by name. Whether you may make this move is decided when you confirm it.',
      ),
    ).toBeVisible();

    await dialog.getByLabel('Search for a leader by name').fill('ann');
    await dialog.getByRole('button', { name: 'Find' }).click();

    await expect
      .poll(() => searches.filter((u) => new URL(u).searchParams.get('q') === 'ann').length, {
        message: 'the picker never searched',
      })
      .toBeGreaterThan(0);
    for (const url of searches.filter((u) => new URL(u).searchParams.get('q') === 'ann')) {
      expect(new URL(url).searchParams.get('network')).toBe('WOMENS');
    }
  });

  test('naming who ran a Cell meeting searches the whole church, in both Networks', async ({
    page,
  }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await mockMeetingRoster(page);
    const searches = await recordSearches(page);

    await page.goto(`/cells/${CELL_WITH_MEETINGS.id}/meetings/2026-06-27`);
    await page.getByRole('radio', { name: 'Someone else' }).check();
    await page.getByLabel('Search for a person by name').fill('Marilou');
    await page.getByRole('button', { name: 'Find' }).click();

    await expect(page.getByRole('button', { name: 'Choose' }).first()).toBeVisible();
    expect(searches.length).toBeGreaterThan(0);
    for (const url of searches) {
      expect(url, 'who ran the meeting was narrowed to one Network').not.toContain('network=');
    }
    await expect(page.getByText(/Network only, because/)).toHaveCount(0);
  });
});

test.describe('the browser Back button on the People screen', () => {
  test('keeps the search in the address, so Back and a reload return to it', async ({ page }) => {
    await mockSignedIn(page);
    await mockPeople(page);
    await page.goto('/people');

    await page.getByLabel('Search by name or Member ID').fill('mar');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=mar/);

    await page.reload();
    await expect(page.getByLabel('Search by name or Member ID')).toHaveValue('mar');

    await page.goBack();
    await expect(page).not.toHaveURL(/q=mar/);
    await expect(page.getByLabel('Search by name or Member ID')).toHaveValue('');
  });
});

test.describe('what the People screen says when it finds nobody', () => {
  test('does not claim it searched the whole church', async ({ page }) => {
    await mockSignedIn(page);
    await page.route('**/api/v1/people?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], next_cursor: null }),
      }),
    );

    await page.goto('/people');
    await page.getByLabel('Search by name').fill('Nobodyhere');
    await page.getByRole('button', { name: 'Search' }).click();

    const main = page.locator('main');
    await expect(main).toContainText('Nobody you oversee matches');

    // **The sentence this replaced.** It read "This searched the whole church, not
    // only the people you pastor. If they are new, add them." — false after decision
    // 0244, and an instruction to create the duplicate on the one screen the ruling
    // narrows. It survived 402 browser tests because none of them read this copy.
    await expect(main).not.toContainText('searched the whole church');
  });
});

test.describe('what the People screen says when a term is too short once tidied', () => {
  // The button counts the term as typed, so `a-` enables it; the API counts it again once
  // normalized and refuses it naming `q`. The screen owes that sentence as the API words
  // it, rather than the pipe's "Some fields need correcting".
  test('shows the API’s sentence for a term like a-', async ({ page }) => {
    await mockSignedIn(page);
    await page.route('**/api/v1/people?*', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Enter at least two letters of a name.',
            details: { field: 'q' },
          },
        }),
      }),
    );

    await page.goto('/people');
    await page.getByLabel('Search by name').fill('a-');
    await page.getByRole('button', { name: 'Search' }).click();

    const main = page.locator('main');
    await expect(main).toContainText('Enter at least two letters of a name.');
    await expect(main).not.toContainText('Some fields need correcting');
  });
});

/**
 * A church-wide picker takes three letters and pages 20 at a time with Show more
 * (SKILL.md section 8, decision 0303). The API enforces both; the picker owes not
 * offering Find for a term the API refuses, and reaching past the first page.
 */
test.describe('a church-wide picker is bounded (decision 0303)', () => {
  test('asks for three letters, and reads the next page with Show more', async ({ page }) => {
    await mockSignedIn(page);
    const person = (n: number) => ({
      ...PERSON_IN_SCOPE,
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      full_name: `Crowd ${n} Testfixture`,
    });
    const searches = await recordSearches(page);
    await page.route('**/api/v1/people?*', (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      const first = cursor === null;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: Array.from({ length: first ? 20 : 3 }, (_, n) => person(first ? n : 20 + n)),
          next_cursor: first ? 'next-page' : null,
        }),
      });
    });

    await page.goto('/people/new');
    const box = page.getByLabel('Search for a leader by name');
    const find = page.getByRole('button', { name: 'Find' });

    await box.fill('Cr');
    await expect(find).toBeDisabled();
    await box.fill('Cro');
    await expect(find).toBeEnabled();
    await find.click();

    await expect(page.getByRole('button', { name: 'Choose' })).toHaveCount(20);
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(page.getByRole('button', { name: 'Choose' })).toHaveCount(23);
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
    // Show more left with the last page, so focus moved to the first person it loaded.
    await expect(page.getByRole('button', { name: 'Choose' }).nth(20)).toBeFocused();

    expect(searches.some((url) => url.includes('cursor=next-page'))).toBe(true);
    for (const url of searches) {
      expect(url, 'the picker asked for more than the API allows').not.toContain('limit=');
    }
  });

  test('keeps the people already shown when Show more is refused', async ({ page }) => {
    await mockSignedIn(page);
    await page.route('**/api/v1/people?*', (route) => {
      if (new URL(route.request().url()).searchParams.get('cursor') !== null) {
        return route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many requests. Try again shortly.',
              details: {},
            },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: Array.from({ length: 20 }, (_, n) => ({
            ...PERSON_IN_SCOPE,
            id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
            full_name: `Crowd ${n} Testfixture`,
          })),
          next_cursor: 'next-page',
        }),
      });
    });

    await page.goto('/people/new');
    await page.getByLabel('Search for a leader by name').fill('Cro');
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.getByRole('button', { name: 'Choose' })).toHaveCount(20);

    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(page.getByText('Too many attempts. Wait a minute and try again.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose' })).toHaveCount(20);
  });
});
