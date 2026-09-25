import { expect, test, type Locator, type Page } from '@playwright/test';

import { PERSON_IN_SCOPE, mockGrants, mockPeople, mockSignedIn } from './mock-api';
import {
  PERSON_SUYNL,
  PERSON_TRAINING,
  mockPersonGrowth,
  type PersonGrowthAnswer,
} from './mock-growth';

/**
 * The Growth frame on a person's page (SKILL.md section 28; owner's choice of 2026-09-24).
 *
 * It has no route of its own: each half is the Growth tab's own list, searched by the
 * person's Member ID and matched by `person_id`, so it shows the reader what that tab
 * would and nothing more. A half the reader cannot see, or a person the list does not
 * return (an archived person is listed on no Growth tab, decision 0279), is left out, and
 * the frame goes with both. Nothing in it is graded or coloured (sections 17 and 19).
 *
 * `accessibility.spec.ts` scans the populated frame; these cases pin what it shows, what
 * it asks for, and when it is not there.
 */

const PROFILE = `/people/${PERSON_IN_SCOPE.id}`;
const MEMBER_ID = PERSON_IN_SCOPE.member_id;
const BOTH = ['suynl.view_subtree', 'training.view_subtree'] as const;

async function openProfile(
  page: Page,
  grants: readonly string[],
  answers: { suynl?: PersonGrowthAnswer; training?: PersonGrowthAnswer } = {},
) {
  await mockSignedIn(page);
  await mockGrants(page, grants);
  await mockPeople(page);
  const traffic = await mockPersonGrowth(page, answers);
  await page.goto(PROFILE);
  // The DCC section beside it, so an absence below is measured on a loaded page.
  await expect(page.getByRole('heading', { name: 'Recent Sundays' })).toBeVisible();
  return traffic;
}

/**
 * Waits for every Growth list the reader may ask for to be answered, and for React to
 * render what came back, so that a frame asserted absent is absent after the answer
 * rather than before it.
 */
async function settled(
  page: Page,
  traffic: { suynl: unknown[]; training: unknown[] },
  expected: {
    suynl: number;
    training: number;
  },
) {
  // At least the number expected, since a refetch would add to it; none where none is.
  await expect.poll(() => traffic.suynl.length).toBeGreaterThanOrEqual(expected.suynl);
  await expect.poll(() => traffic.training.length).toBeGreaterThanOrEqual(expected.training);
  await page.waitForLoadState('networkidle');
  if (expected.suynl === 0) expect(traffic.suynl).toHaveLength(0);
  if (expected.training === 0) expect(traffic.training).toHaveLength(0);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

function frame(page: Page): Locator {
  return page.getByRole('region', { name: 'Growth' });
}

/** The ten lesson boxes, as their accessible text reads: a tick and a spoken state. */
function boxes(done: readonly number[]): string[] {
  return Array.from({ length: 10 }, (_, index) =>
    done.includes(index + 1) ? `✓Lesson ${index + 1}: done` : `Lesson ${index + 1}: not done`,
  );
}

test.describe('a person’s Growth, read-only', () => {
  test('shows both rows: lessons with the latest day, schools with their dates', async ({
    page,
  }) => {
    await openProfile(page, BOTH);

    const growth = frame(page);
    await expect(growth.getByRole('heading', { name: 'Growth' })).toBeVisible();

    // Three lessons, the latest filed on 6 September though the fixture lists it second.
    await expect(growth.getByText('3 of 10 lessons · latest 6 September 2026')).toBeVisible();
    await expect(growth.getByRole('list', { name: 'Lessons' }).getByRole('listitem')).toHaveText(
      boxes([1, 2, 4]),
    );

    // Encounter first whatever order the API sends, and a school with no date says so.
    await expect(growth.getByText(/^2 of 5(?!\d)/)).toBeVisible();
    await expect(
      growth.getByRole('listitem').filter({ hasText: /^(Encounter|Life Class|SOL \d) · / }),
    ).toHaveText(['Encounter · 8 March 2026', 'Life Class · no date']);

    await expect(growth.getByRole('link', { name: 'Open SUYNL' })).toHaveAttribute(
      'href',
      `/growth/suynl?q=${MEMBER_ID}`,
    );
    await expect(growth.getByRole('link', { name: 'Open Training' })).toHaveAttribute(
      'href',
      `/growth/training?q=${MEMBER_ID}`,
    );
  });

  test('asks each list for this Member ID and one row, and nothing else', async ({ page }) => {
    const traffic = await openProfile(page, BOTH);
    await expect(frame(page).getByRole('link', { name: 'Open Training' })).toBeVisible();

    for (const sent of [...traffic.suynl, ...traffic.training]) {
      expect(Object.fromEntries(sent)).toEqual({ q: MEMBER_ID, limit: '1' });
    }
    expect(traffic.suynl.length).toBeGreaterThan(0);
    expect(traffic.training.length).toBeGreaterThan(0);
  });

  test('says plainly when a listed person has no lessons and no schools', async ({ page }) => {
    await openProfile(page, BOTH, {
      suynl: { rows: [{ ...PERSON_SUYNL, lessons: [] }] },
      training: { rows: [{ ...PERSON_TRAINING, graduations: [] }] },
    });

    const growth = frame(page);
    await expect(growth.getByText('No lessons yet', { exact: true })).toBeVisible();
    await expect(growth.getByText('No graduations yet', { exact: true })).toBeVisible();
    await expect(growth.getByRole('list', { name: 'Lessons' }).getByRole('listitem')).toHaveText(
      boxes([]),
    );
    await expect(growth.getByText(/of 10 lessons|of 5/)).toHaveCount(0);
    // The way to the tab stays, because that is where the first one is filed.
    await expect(growth.getByRole('link', { name: 'Open SUYNL' })).toBeVisible();
    await expect(growth.getByRole('link', { name: 'Open Training' })).toBeVisible();
  });
});

test.describe('when the frame, or half of it, is left out', () => {
  test('is absent, and asks for nothing, for a reader holding neither view capability', async ({
    page,
  }) => {
    const traffic = await openProfile(page, []);
    await settled(page, traffic, { suynl: 0, training: 0 });

    await expect(frame(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Growth' })).toHaveCount(0);
  });

  test('shows only SUYNL to a reader holding only suynl.view_subtree', async ({ page }) => {
    const traffic = await openProfile(page, ['suynl.view_subtree']);
    await expect(frame(page).getByRole('link', { name: 'Open SUYNL' })).toBeVisible();
    await settled(page, traffic, { suynl: traffic.suynl.length, training: 0 });

    await expect(frame(page).getByText('Training', { exact: true })).toHaveCount(0);
    await expect(frame(page).getByRole('link', { name: 'Open Training' })).toHaveCount(0);
  });

  test('shows only Training to a reader holding only training.view_subtree', async ({ page }) => {
    const traffic = await openProfile(page, ['training.view_subtree']);
    await expect(frame(page).getByRole('link', { name: 'Open Training' })).toBeVisible();
    await settled(page, traffic, { suynl: 0, training: traffic.training.length });

    await expect(frame(page).getByText('SUYNL', { exact: true })).toHaveCount(0);
    await expect(frame(page).getByRole('list', { name: 'Lessons' })).toHaveCount(0);
  });

  test('is absent when neither list returns this person (an archived person, decision 0279)', async ({
    page,
  }) => {
    const traffic = await openProfile(page, BOTH, { suynl: { rows: [] }, training: { rows: [] } });
    await settled(page, traffic, { suynl: 1, training: 1 });

    await expect(frame(page)).toHaveCount(0);
  });

  test('is absent when the search matches somebody else, whose row is not taken for theirs', async ({
    page,
  }) => {
    const other = { person_id: '11111111-2222-4333-8444-555555555556', member_id: `${MEMBER_ID}1` };
    const traffic = await openProfile(page, BOTH, {
      suynl: { rows: [{ ...PERSON_SUYNL, ...other, full_name: 'Rosendo Villamor' }] },
      training: { rows: [{ ...PERSON_TRAINING, ...other, full_name: 'Rosendo Villamor' }] },
    });
    await settled(page, traffic, { suynl: 1, training: 1 });

    await expect(frame(page)).toHaveCount(0);
    await expect(page.getByText('3 of 10 lessons', { exact: false })).toHaveCount(0);
  });

  for (const code of ['SCOPE_DENIED', 'CAPABILITY_DENIED'] as const) {
    test(`a ${code} refusal leaves that half out without a word`, async ({ page }) => {
      await openProfile(page, BOTH, { suynl: { refused: code } });

      const growth = frame(page);
      await expect(growth.getByRole('link', { name: 'Open Training' })).toBeVisible();
      await expect(growth.getByText('SUYNL', { exact: true })).toHaveCount(0);
      await expect(growth.getByText('Couldn’t load this just now.')).toHaveCount(0);
      await expect(page.getByText(code)).toHaveCount(0);
    });
  }

  test('is absent when both lists refuse', async ({ page }) => {
    const traffic = await openProfile(page, BOTH, {
      suynl: { refused: 'SCOPE_DENIED' },
      training: { refused: 'CAPABILITY_DENIED' },
    });
    await settled(page, traffic, { suynl: 1, training: 1 });

    await expect(frame(page)).toHaveCount(0);
  });

  test('a failure that is not a refusal says so for that half, and keeps the other', async ({
    page,
  }) => {
    await openProfile(page, BOTH, { training: { failed: true } });

    const growth = frame(page);
    await expect(growth.getByRole('link', { name: 'Open SUYNL' })).toBeVisible();
    const training = growth
      .locator('div')
      .filter({ has: page.getByText('Training', { exact: true }) });
    await expect(training.getByText('Couldn’t load this just now.')).toBeVisible();
    await expect(growth.getByText('Couldn’t load this just now.')).toHaveCount(1);
    await expect(growth.getByRole('link', { name: 'Open Training' })).toHaveCount(0);
  });

  test('shows the frame with both failure lines when both lists fail', async ({ page }) => {
    await openProfile(page, BOTH, { suynl: { failed: true }, training: { failed: true } });

    const growth = frame(page);
    await expect(growth.getByText('Couldn’t load this just now.')).toHaveCount(2);
    await expect(growth.getByText('SUYNL', { exact: true })).toBeVisible();
    await expect(growth.getByText('Training', { exact: true })).toBeVisible();
  });
});

test('nothing in the frame is graded by colour; only its links carry the accent', async ({
  page,
}) => {
  await openProfile(page, BOTH);
  await expect(frame(page).getByRole('link', { name: 'Open Training' })).toBeVisible();

  // The frame's own surface is FRAME's, shared by every frame on the page, so the section
  // itself is not examined; everything inside it is, the two links apart, whose accent is
  // TextLink's and says "link" rather than anything about the person.
  const coloured = await frame(page).evaluate((section) =>
    Array.from(section.querySelectorAll('*'))
      .filter((node) => node.closest('a') === null)
      .map((node) => String(node.getAttribute('class') ?? ''))
      .filter((classes) =>
        /(^|\s)(bg-|text-accent|text-field-invalid|border-accent)/.test(classes),
      ),
  );

  expect(coloured).toEqual([]);
});
