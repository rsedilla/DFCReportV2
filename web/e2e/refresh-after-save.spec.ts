import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn } from './mock-api';
import { mockCellMeetings, mockMeetingRoster } from './mock-attendance';

/**
 * Every save the server accepts reads every figure and list again (owner's choice of
 * 2026-10-14, option A), by one rule in `lib/session.ts` rather than by each screen naming
 * what its save moves. Pinned on a read the Cell meeting screen's own save names nowhere,
 * `GET /auth/me`, so only the rule can be what asks for it again.
 */

const MEETING = '/cells/3f1b7c6e-0000-4000-8000-000000000101/meetings/2026-06-27';

async function countMe(page: Page): Promise<() => number> {
  let count = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && request.url().endsWith('/api/v1/auth/me')) {
      count += 1;
    }
  });
  return () => count;
}

async function markAndSave(page: Page) {
  await expect(page.getByRole('radio', { name: 'Present' })).toHaveCount(2);
  for (const radio of await page.getByRole('radio', { name: 'Present' }).all()) {
    await radio.check();
  }
  await page.getByRole('button', { name: 'Save meeting' }).click();
}

test('reads what is on screen again after a save the server accepted', async ({ page }) => {
  await mockSignedIn(page);
  await mockCellMeetings(page);
  await mockMeetingRoster(page);
  await page.route('**/api/v1/cells/*/meetings/*/submit', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '{}' }),
  );
  const asked = await countMe(page);

  await page.goto(MEETING);
  await expect.poll(asked).toBeGreaterThan(0);
  const before = asked();

  await markAndSave(page);

  await expect.poll(asked).toBeGreaterThan(before);
});

test('reads nothing again after a save the server refused', async ({ page }) => {
  await mockSignedIn(page);
  await mockCellMeetings(page);
  await mockMeetingRoster(page);
  await page.route('**/api/v1/cells/*/meetings/*/submit', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INVARIANT_VIOLATION', message: 'Refused.' } }),
    }),
  );
  const asked = await countMe(page);

  await page.goto(MEETING);
  await expect.poll(asked).toBeGreaterThan(0);
  const before = asked();

  await markAndSave(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Refused.' })).toBeVisible();

  expect(asked()).toBe(before);
});
