import { expect, test, type Page } from '@playwright/test';

import { mockSignedIn, mockWholeChurchReader } from './mock-api';
import {
  mockCellReport,
  mockCellTwelve,
  mockDccReport,
  mockDccTwelve,
  TWELVE,
} from './mock-attendance';

/**
 * A report opened for a leader whose record was merged away (SKILL.md section 3, decision 0408,
 * point 22): the address is replaced with the record kept, and the page says the old record was
 * merged into it, as the old record's own page does (point 17). Choosing another leader keeps
 * nothing of it.
 *
 * `api/test/api/person-merge.e2e.spec.ts` pins who may read the kept record's report and what
 * its figures count. This pins what the screen does with a merged leader in its address.
 *
 * The clock is fixed at 10:00 on Saturday 20 June 2026 in Manila, as the other report suites.
 * Names and Member IDs are invented (CLAUDE.md, Secrets).
 */
const NOW = new Date('2026-06-20T02:00:00Z');
const TODAY = '2026-06-20';

/** The retired record: Consuelo Bautista recorded twice, merged into `TWELVE.consuelo`. */
const ABSORBED = { id: '3f1b7c6e-0000-4000-8000-000000000799', member_id: 'M-000899' };

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

function person(id: string, memberId: string, merged: unknown) {
  return {
    id,
    member_id: memberId,
    full_name: 'Consuelo Bautista',
    title: null,
    first_name: 'Consuelo',
    middle_name: null,
    last_name: 'Bautista',
    birth_date: null,
    sex: 'FEMALE',
    civil_status: 'SINGLE',
    mobile_number: null,
    merged,
  };
}

/** The absorbed record's page names the record kept; the record kept is merged into nothing. */
async function mockMergedLeader(page: Page) {
  await page.route(`**/api/v1/people/${ABSORBED.id}`, (route) =>
    route.fulfill(
      json(
        person(ABSORBED.id, ABSORBED.member_id, {
          into: {
            id: TWELVE.consuelo.id,
            member_id: TWELVE.consuelo.member_id,
            full_name: TWELVE.consuelo.full_name,
          },
          merged_at: '2026-06-18T02:00:00.000Z',
          merged_by: 'Adele Ferrer',
        }),
      ),
    ),
  );
  // A different record, merged into somebody else: Efren.
  await page.route(`**/api/v1/people/${ELSEWHERE.id}`, (route) =>
    route.fulfill(
      json(
        person(ELSEWHERE.id, ELSEWHERE.member_id, {
          into: {
            id: TWELVE.efren.id,
            member_id: TWELVE.efren.member_id,
            full_name: TWELVE.efren.full_name,
          },
          merged_at: '2026-06-18T02:00:00.000Z',
          merged_by: 'Adele Ferrer',
        }),
      ),
    ),
  );
  for (const leader of [TWELVE.consuelo, TWELVE.aurora]) {
    await page.route(`**/api/v1/people/${leader.id}`, (route) =>
      route.fulfill(json(person(leader.id, leader.member_id, null))),
    );
  }
}

/** A record merged into Efren, not into the leader a crafted address names. */
const ELSEWHERE = { id: '3f1b7c6e-0000-4000-8000-000000000798', member_id: 'M-000898' };

const NOTE = `${ABSORBED.member_id} was merged into this record.`;

for (const report of [
  {
    name: 'DCC',
    path: '/reports/dcc',
    arrange: async (page: Page) => {
      await mockDccReport(page);
      await mockDccTwelve(page, { today: TODAY });
    },
  },
  {
    name: 'Cell Groups',
    path: '/reports/cells',
    arrange: async (page: Page) => {
      await mockCellReport(page);
      await mockCellTwelve(page, { today: TODAY });
    },
  },
] as const) {
  test.describe(`${report.name} opened for a leader merged away (decision 0408, point 22)`, () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(NOW);
      await mockSignedIn(page);
      await mockWholeChurchReader(page);
      await report.arrange(page);
      await mockMergedLeader(page);
    });

    test('opens the record kept, and says the old record was merged into it', async ({ page }) => {
      await page.goto(`${report.path}?month=2026-06-01&leader=${ABSORBED.id}`);

      await expect(page).toHaveURL(new RegExp(`[?&]leader=${TWELVE.consuelo.id}`));
      await expect(page).toHaveURL(new RegExp(`[?&]merged_from=${ABSORBED.id}`));
      await expect(page).not.toHaveURL(new RegExp(`leader=${ABSORBED.id}`));
      await expect(page.getByText(NOTE)).toBeVisible();
    });

    test('shows no note for a crafted address naming a record that was not merged into the leader', async ({
      page,
    }) => {
      // Aurora was never merged; the other record was merged into Efren, not Consuelo. The line
      // is the server's, so neither address can make the report claim a merge.
      for (const from of [TWELVE.aurora.id, ELSEWHERE.id]) {
        // Read back before the note is looked for, so its absence is the decision, not a wait.
        const readBack = page.waitForResponse((response) =>
          response.url().endsWith(`/api/v1/people/${from}`),
        );
        await page.goto(
          `${report.path}?month=2026-06-01&leader=${TWELVE.consuelo.id}&merged_from=${from}`,
        );
        await readBack;
        await expect(page.getByRole('table')).not.toHaveCount(0);
        await expect(page.getByText(/was merged into this record/)).toHaveCount(0);
        await expect(page).toHaveURL(new RegExp(`[?&]leader=${TWELVE.consuelo.id}`));
      }
    });

    test('shows no note once another leader is chosen', async ({ page }) => {
      await page.goto(`${report.path}?month=2026-06-01&leader=${ABSORBED.id}`);
      await expect(page.getByText(NOTE)).toBeVisible();

      await page.getByLabel('Figures for').selectOption(TWELVE.aurora.id);
      await expect(page).toHaveURL(new RegExp(`[?&]leader=${TWELVE.aurora.id}`));
      await expect(page.getByText(NOTE)).toHaveCount(0);
    });

    test('shows no note for a leader never merged', async ({ page }) => {
      await page.goto(`${report.path}?month=2026-06-01&leader=${TWELVE.consuelo.id}`);

      await expect(page).toHaveURL(new RegExp(`[?&]leader=${TWELVE.consuelo.id}`));
      await expect(page.getByRole('table')).not.toHaveCount(0);
      await expect(page.getByText(/was merged into this record/)).toHaveCount(0);
    });
  });
}
