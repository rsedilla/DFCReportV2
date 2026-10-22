import { expect, test, type Page } from '@playwright/test';

import {
  mockAwaitingReassignment,
  mockPeopleWithoutACell,
  mockSignedIn,
  mockWholeChurchReader,
} from './mock-api';
import {
  PENDING_CG_ROWS,
  mockCellMeetings,
  mockCellReport,
  mockCells,
  mockDccEvents,
  mockDccOwed,
  mockDccReport,
  mockDccRoster,
  mockMeetingsAwaiting,
  mockPendingCg,
  mockPendingDcc,
} from './mock-attendance';

/**
 * A choice on a screen changes its address in the browser, with no round trip to the server
 * (`lib/screen-address.ts`).
 *
 * Every screen is drawn in the browser from the address and the API, so the server has
 * nothing to add when a tab, a filter or a month is chosen. A navigation that asked it first
 * left the tab unchanged until it answered, and when that request failed — under load, or
 * after a deploy — the framework fell back to loading the whole page, and the click was lost
 * (checklist row later-record-tab-reload, found 6 October).
 */

/** 10:00 on 20 June 2026 in Manila. */
const JUNE_20 = new Date('2026-06-20T02:00:00Z');

async function openRecord(page: Page) {
  await page.clock.setFixedTime(JUNE_20);
  await mockSignedIn(page);
  await mockWholeChurchReader(page);
  await mockCells(page);
  await mockCellMeetings(page);
  await mockMeetingsAwaiting(page);
  await mockCellReport(page);
  await mockDccReport(page);
  await mockDccEvents(page);
  await mockDccRoster(page);
  await mockAwaitingReassignment(page);
  await mockPeopleWithoutACell(page);
  await mockPendingDcc(page);
  await mockDccOwed(page);
  await mockPendingCg(page, [PENDING_CG_ROWS[0]]);
}

function recordLists(page: Page) {
  return page.getByRole('group', { name: 'Outstanding work', exact: true });
}

test('a Record tab switches with the server unreachable, and the page is not loaded again', async ({
  page,
}) => {
  await openRecord(page);
  await page.goto('/dashboard');
  const pending = recordLists(page).getByRole('button', { name: /^Pending CG Records/ });
  await expect(pending).toBeVisible();

  // From here the web server answers nothing: a page request of any kind fails, as it does
  // when the server is overloaded or restarting. The API stays mocked.
  const asked: string[] = [];
  const reloads: string[] = [];
  await page.route(
    (url) => url.pathname.startsWith('/dashboard'),
    (route) => {
      // A link loading ahead of a click (the sidebar's Record) is not the choice asking, and
      // its failing changes nothing on screen.
      if (route.request().headers()['next-router-prefetch'] === undefined) {
        asked.push(route.request().url());
      }
      return route.abort('failed');
    },
  );
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      reloads.push(request.url());
    }
  });

  // One click, with no retry: the click is what used to be lost.
  await pending.click();

  await expect(pending).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 });
  await expect(page).toHaveURL(/[?&]list=behind\b/);
  // The choice asked the server for nothing at all.
  expect(asked).toEqual([]);

  // Back steps through the choice, and the page is not loaded again. The framework may
  // still ask in the background for the screen it is returning to; that failing is harmless,
  // and the screen must stay as it is.
  await page.goBack();
  const update = recordLists(page).getByRole('button', { name: /^Update Records/ });
  await expect(update).toHaveAttribute('aria-pressed', 'true');
  await expect(page).not.toHaveURL(/list=/);
  await page.waitForTimeout(1_500);
  await expect(update).toHaveAttribute('aria-pressed', 'true');
  expect(reloads).toEqual([]);
});
